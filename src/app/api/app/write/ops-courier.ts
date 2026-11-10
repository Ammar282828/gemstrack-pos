/**
 * TCS from the ERP (owner, 2026-11-09: "make the shipping slips (CN bookings) … everything I'd need directly from my ERP").
 * Owners and staff: the counter packs and books the parcel. The account is the sealed one in Settings → Integrations → TCS
 * (lib/tcs-cod.ts); until TCS opens it to the API, booking answers with TCS's own refusal and nothing is written.
 *
 *   { op: 'bookTcs', orderId | invoiceId, consignee: { name, address, mobile, email? }, destinationCity, weight (kg), pieces,
 *     codAmount, fragile?, remarks?, productDetails?, fulfilShopify? (default true), notifyCustomer? (default true) }
 *   → { ok: true, cn, booking (lib/tcs-booking.ts TcsBooking), url, shopify?: { ok, message } }
 *   Writes tcsConsignmentNo and tcsBooking on the order or invoice. A Shopify order behind it is fulfilled with the number
 *   as its tracking (TCS, the number, TCS's tracking page), unless fulfilShopify is false; a Shopify failure never undoes
 *   the booking, it is reported beside it.
 *
 *   { op: 'cancelTcs', orderId | invoiceId } → { ok: true, cn }: cancelled with TCS, tcsConsignmentNo cleared,
 *   tcsBooking.cancelledAt set, the number kept in tcsCancelledCns. A parcel already moving is refused (409). Only a booking made here (tcsBooking) is cancelled; one Universal Courier made is not ours.
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { TcsError, codAccount, tcsCancelOrder, tcsCities, tcsCreateOrder } from '@/lib/tcs-cod-server';
import { matchCity, tcsTrackUrl } from '@/lib/tcs-cod';
import type { TcsBooking } from '@/lib/tcs-booking';
import { fulfilShopifyOrder } from '@/lib/shopify-fulfil-server';
import { BOOKING, bookingStateOf } from '@/lib/machines';
import { assertMove } from '@/lib/machines/machine';
import { moveRefusedResponse } from '@/lib/machines/http';
import { getTracking } from '@/lib/tracking-server';
import type { OpHandler, OpRoles } from './op-context';

export const COURIER_OPS: OpRoles = {
  bookTcs: ['owner', 'staff'],
  cancelTcs: ['owner', 'staff'],
};

/** A parcel TCS has in hand: it cannot be cancelled from here. */
const PARCEL_MOVING: string[] = ['shipped', 'in_transit', 'out_for_delivery', 'delivered', 'returned'];

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') && !/^__.*__$/.test(s) ? s : '';
};

export const runCourierOp: OpHandler = async (op, body, ctx) => {
  if (!(op in COURIER_OPS)) return null;
  const orderId = idOf(body.orderId), invoiceId = idOf(body.invoiceId);
  if (!orderId === !invoiceId) return bad('Which order or invoice?');
  const kind = orderId ? 'order' : 'invoice';
  const id = orderId || invoiceId;
  const ref = adminDb.collection(kind === 'order' ? 'orders' : 'invoices').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return bad(`${kind === 'order' ? 'Order' : 'Invoice'} ${id} was not found.`, 404);
  const doc = snap.data() as Record<string, unknown> & { tcsConsignmentNo?: string; tcsBooking?: TcsBooking; shopifyOrderId?: string; shopifyOrderName?: string };

  try {
    if (op === 'cancelTcs') {
      const b = doc.tcsBooking;
      if (!b?.cn || b.cancelledAt) return bad('There is no TCS booking made from the ERP on it to cancel.', 409);
      // The booking machine (lib/machines): a parcel TCS already has moving is not cancelled from here.
      const tracked = await getTracking({ cn: b.cn, fresh: true }).catch(() => null);
      assertMove(BOOKING, bookingStateOf(doc), 'cancelled', 'cancel', { orderOpen: true, parcelMoving: !!tracked && PARCEL_MOVING.includes(tracked.state) });
      await tcsCancelOrder(b.cn);
      const at = new Date().toISOString();
      await ref.update({
        tcsBooking: { ...b, cancelledAt: at },
        // Remembered, so Shopify's tracking or the order's own number never brings this cancelled booking back.
        tcsCancelledCns: FieldValue.arrayUnion(b.cn),
        ...(doc.tcsConsignmentNo === b.cn ? { tcsConsignmentNo: FieldValue.delete() } : {}),
      });
      await adminDb.collection('tcs_tracking').doc(b.cn).delete().catch(() => {});
      await ctx.log(`${kind}.update`, `TCS booking ${b.cn} cancelled`, `${kind === 'order' ? 'Order' : 'Invoice'} ${id}`, id);
      return NextResponse.json({ ok: true, cn: b.cn });
    }

    // bookTcs
    if (doc.tcsBooking?.cn && !doc.tcsBooking.cancelledAt) return bad(`Already booked with TCS: ${doc.tcsBooking.cn}. Cancel it first to book again.`, 409);
    if (doc.tcsConsignmentNo && body.force !== true) return bad(`It already has a TCS number (${doc.tcsConsignmentNo}), likely booked through Shopify. Book again only if that parcel was cancelled.`, 409);
    // The booking machine: no parcel for an order the shop cancelled or refunded (an invoice has no such status).
    const orderOpen = kind === 'invoice' || (doc.status !== 'Cancelled' && doc.status !== 'Refunded');
    assertMove(BOOKING, bookingStateOf(doc), 'pending', 'book', { orderOpen, parcelMoving: false });
    const account = await codAccount();
    const c = (body.consignee && typeof body.consignee === 'object' ? body.consignee : {}) as Record<string, unknown>;
    const cities = await tcsCities().catch(() => [] as string[]);
    const destinationCity = matchCity(String(body.destinationCity ?? ''), cities);
    const reference = String(doc.shopifyOrderName || '').trim() || id;
    const input = {
      consignee: { name: String(c.name ?? ''), address: String(c.address ?? ''), mobile: String(c.mobile ?? ''), email: String(c.email ?? '') },
      destinationCity,
      weight: Number(body.weight),
      pieces: Number(body.pieces ?? 1),
      codAmount: Number(body.codAmount ?? 0),
      reference,
      productDetails: typeof body.productDetails === 'string' ? body.productDetails : undefined,
      fragile: body.fragile !== false,
      remarks: typeof body.remarks === 'string' ? body.remarks : '',
    };
    // Two taps, two devices: one booking. A claim on the document for the minute TCS takes to answer.
    const claimed = await adminDb.runTransaction(async tx => {
      const cur = (await tx.get(ref)).data() || {};
      const pending = typeof cur.tcsBookingPending === 'string' ? Date.parse(cur.tcsBookingPending) : 0;
      if ((cur.tcsBooking?.cn && !cur.tcsBooking.cancelledAt) || (pending && Date.now() - pending < 90_000)) return false;
      tx.update(ref, { tcsBookingPending: new Date().toISOString() });
      return true;
    });
    if (!claimed) return bad('It is being booked already (or was just booked). Wait a moment and reload.', 409);
    let cn = '';
    try { ({ cn } = await tcsCreateOrder(input)); }
    finally { if (!cn) await ref.update({ tcsBookingPending: FieldValue.delete() }).catch(() => {}); }
    const booking: TcsBooking = {
      cn, bookedAt: new Date().toISOString(), by: ctx.email,
      codAmount: Math.round(input.codAmount) || 0, destinationCity, weight: Math.round(input.weight * 100) / 100,
      pieces: Math.round(input.pieces) || 1, reference,
      consignee: { name: input.consignee.name.trim(), address: input.consignee.address.trim(), mobile: input.consignee.mobile.trim() },
      originCity: account.originCity || 'Karachi',
    };
    await ref.update({ tcsConsignmentNo: cn, tcsBooking: booking, tcsBookingPending: FieldValue.delete() });
    await ctx.log(`${kind}.update`, `Booked with TCS: ${cn}`, `${kind === 'order' ? 'Order' : 'Invoice'} ${id} · to ${destinationCity} · COD PKR ${booking.codAmount.toLocaleString('en-PK')}`, id);

    let shopify: { ok: boolean; message: string } | undefined;
    if (doc.shopifyOrderId && body.fulfilShopify !== false) {
      try {
        const r = await fulfilShopifyOrder(String(doc.shopifyOrderId), {
          notifyCustomer: body.notifyCustomer !== false,
          tracking: { number: cn, company: 'TCS', url: tcsTrackUrl(cn) },
        });
        shopify = { ok: r.ok, message: r.message };
      } catch (e) {
        shopify = { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : 'Shopify did not answer.' };
      }
      await ref.update({ 'tcsBooking.shopify': shopify }).catch(() => {});
    }
    return NextResponse.json({ ok: true, cn, url: tcsTrackUrl(cn), booking: { ...booking, ...(shopify ? { shopify } : {}) }, ...(shopify ? { shopify } : {}) });
  } catch (e) {
    const refused = moveRefusedResponse(e);
    if (refused) return refused;
    if (e instanceof TcsError) return bad(e.message, e.status);
    console.error('[ops-courier]', op, e);
    return bad(e instanceof Error ? e.message : 'TCS booking failed.', 500);
  }
};
