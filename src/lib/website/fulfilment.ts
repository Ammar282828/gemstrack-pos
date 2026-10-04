/**
 * What the shop does to an online order once it is confirmed (online.ts).
 *
 * Each move idempotent and each telling the customer what happened:
 *
 *   transfer received  — the money is in the account. Booked the way the counter books an
 *                        advance: a dated Bank Transfer line in `advances` for the pieces, so
 *                        the balance (`grandTotal`) is 0 and Cash In / Today's cash count it
 *                        that day; and the delivery charge, which is not a piece, as extra
 *                        revenue. The order stays where its pieces put it — Not started, to
 *                        give out (lib/order-stage.ts).
 *   lapse              — no money came by the end of the hold, and the shop has checked the bank:
 *                        the order is Cancelled and the customer told. Never automatic.
 *   ship               — book with Leopards, or record a consignment number
 *                        typed in at the counter, and send the tracking link.
 *   delivered          — close the order.
 *
 * These run server-side because the second one holds Leopards' credentials and
 * all three send WhatsApp from the shop's number; neither belongs in a browser.
 */

import { adminDb } from '@/lib/firebase-admin';
import { bookPacket, leopardsConfig, trackingUrlFor, trackPacket } from '@/lib/leopards';
import { STORE_CONFIG } from '@/lib/store-config';
import { customerExpiredMessage, customerPaidMessage, customerShippedMessage, trySend } from './notify';
import type { LeopardsMeta, WebsiteOrderMeta } from './types';

export class FulfilmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

interface OrderDoc {
  id: string;
  status?: string;
  customerName?: string;
  customerContact?: string;
  grandTotal?: number;
  subtotal?: number;
  discountAmount?: number;
  advancePayment?: number;
  advances?: { amount: number; date: string; method?: string; notes?: string }[];
  advanceInExchangeValue?: number;
  invoiceId?: string;
  delivery?: { address?: string; city?: string; contactName?: string; contactPhone?: string };
  items?: { estimatedWeightG?: number }[];
  website?: WebsiteOrderMeta;
  leopards?: LeopardsMeta;
}

async function load(id: string): Promise<OrderDoc> {
  const snap = await adminDb.collection('orders').doc(id).get();
  if (!snap.exists) throw new FulfilmentError('Order not found', 404);
  const o = { id: snap.id, ...(snap.data() as Omit<OrderDoc, 'id'>) };
  if (!o.website) throw new FulfilmentError('Not a website order', 409);
  return o;
}

/** The customer's reference for it: the ONL- number they were given, or the order's own. */
const refOf = (o: OrderDoc) => o.website?.onlineId || o.id;

/** What the customer pays: the pieces and the delivery. */
export const customerTotal = (o: Pick<OrderDoc, 'subtotal' | 'website'>) =>
  typeof o.website?.total === 'number' ? o.website.total : (Number(o.subtotal) || 0) + (o.website?.deliveryCharge || 0);

export async function markTransferReceived(id: string, by: string): Promise<{ ok: true; notified: string | null }> {
  const ref = adminDb.collection('orders').doc(id);
  const now = new Date().toISOString();
  const done = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new FulfilmentError('Order not found', 404);
    const o = { id: snap.id, ...(snap.data() as Omit<OrderDoc, 'id'>) };
    if (!o.website) throw new FulfilmentError('Not an online order', 409);
    if (o.website.paymentStatus === 'transfer_received') return null;
    if (o.status === 'Cancelled' || o.status === 'Refunded') throw new FulfilmentError('The order is closed. Reopen it before recording money on it.', 409);
    if (o.invoiceId) throw new FulfilmentError('The order is invoiced already: take the payment on its invoice.', 409);
    // What the pieces still owe, worked out as recording an advance does (store.recordOrderAdvance).
    const advanced = Number(o.advancePayment) || 0;
    const owed = Math.max(0, (Number(o.subtotal) || 0) - (Number(o.discountAmount) || 0) - advanced - (Number(o.advanceInExchangeValue) || 0));
    const line = { amount: owed, date: now, method: 'Bank Transfer', notes: `Bank transfer for online order ${refOf(o)}` };
    const delivery = o.website.deliveryCharge || 0;
    const revenue = delivery > 0 ? adminDb.collection('additional_revenue').doc() : null;
    if (revenue) tx.set(revenue, { date: now, amount: delivery, orderId: id, description: `Delivery charge — online order ${id}${o.website.onlineId ? ` (${o.website.onlineId})` : ''}, Leopards to ${o.delivery?.city || 'the customer'}` });
    tx.update(ref, {
      ...(owed > 0 ? { advancePayment: advanced + owed, advances: [...(o.advances || []), line] } : {}),
      grandTotal: 0,
      'website.paymentStatus': 'transfer_received',
      'website.paidAt': now,
      'website.paidConfirmedBy': by,
      ...(revenue ? { 'website.deliveryRevenueId': revenue.id } : {}),
    });
    return o;
  });
  if (!done) return { ok: true, notified: null };
  const notified = await trySend(done.customerContact, customerPaidMessage(refOf(done), done.customerName || 'there'));
  return { ok: true, notified };
}

/** No money by the end of the hold, and the bank checked: close it and tell the customer. */
export async function lapseOrder(id: string, by: string): Promise<{ ok: true; notified: string | null }> {
  const o = await load(id);
  const w = o.website!;
  if (w.paymentStatus === 'expired') return { ok: true, notified: null };
  if (w.paymentStatus === 'transfer_received') throw new FulfilmentError('The transfer is recorded: this order is paid.', 409);
  if (o.status !== 'Pending' && o.status !== 'In Progress') throw new FulfilmentError(`The order is ${o.status}.`, 409);
  await adminDb.collection('orders').doc(id).update({
    status: 'Cancelled',
    'website.paymentStatus': 'expired',
    'website.expiredAt': new Date().toISOString(),
    'website.lapsedBy': by,
  });
  const notified = await trySend(o.customerContact, customerExpiredMessage(refOf(o), o.customerName || 'there'));
  return { ok: true, notified };
}

export async function shipOrder(id: string, by: string, manualCn?: string): Promise<{ ok: true; leopards: LeopardsMeta; notified: string | null }> {
  const o = await load(id);
  if (o.website!.paymentStatus !== 'transfer_received') throw new FulfilmentError('Record the transfer before shipping', 409);
  if (o.leopards?.cn) return { ok: true, leopards: o.leopards, notified: null };

  let meta: LeopardsMeta;
  if (manualCn && manualCn.trim()) {
    const cn = manualCn.trim();
    meta = { cn, bookedAt: new Date().toISOString(), trackingUrl: trackingUrlFor(cn), manual: true };
  } else {
    if (!leopardsConfig()) throw new FulfilmentError('Leopards is not connected. Book at the counter and enter the CN number.', 409);
    const d = o.delivery || {};
    const weight = (o.items || []).reduce((s, it) => s + (it.estimatedWeightG || 0), 0);
    const booked = await bookPacket({
      orderId: id,
      weightGrams: weight,
      collectAmount: 0,
      originCity: 'Karachi',
      destinationCity: d.city || '',
      shipper: {
        name: STORE_CONFIG.name || 'TAHERI',
        phone: STORE_CONFIG.contact1Number || '',
        // Leopards needs an address on the slip, and the customer reads the slip: never the market's
        // name (docs/decisions.md, Customer copy). The pickup itself is the Leopards account's address.
        address: process.env.WEBSITE_SHIP_FROM_ADDRESS || `${STORE_CONFIG.name || 'TAHERI'}, Karachi`,
      },
      consignee: { name: d.contactName || o.customerName || '', phone: d.contactPhone || o.customerContact || '', address: `${d.address || ''}, ${d.city || ''}` },
    });
    meta = { cn: booked.cn, bookedAt: new Date().toISOString(), trackingUrl: booked.trackingUrl };
  }
  // The status is the pieces' to set (lib/order-stage.ts): shipped is the Leopards line, not "In Progress".
  await adminDb.collection('orders').doc(id).update({ leopards: meta, 'website.shippedBy': by });
  const notified = await trySend(o.customerContact, customerShippedMessage(refOf(o), o.customerName || 'there', meta.cn, meta.trackingUrl));
  return { ok: true, leopards: meta, notified };
}

export async function markDelivered(id: string): Promise<{ ok: true }> {
  const o = await load(id);
  if (!o.leopards?.cn) throw new FulfilmentError('Nothing has been shipped yet', 409);
  await adminDb.collection('orders').doc(id).update({ 'leopards.deliveredAt': new Date().toISOString(), status: 'Completed' });
  return { ok: true };
}

/** Ask Leopards where the packet is. Read-only; nothing is written unless it says delivered. */
export async function refreshTracking(id: string) {
  const o = await load(id);
  if (!o.leopards?.cn) throw new FulfilmentError('Nothing has been shipped yet', 409);
  const t = await trackPacket(o.leopards.cn);
  if (t.delivered && !o.leopards.deliveredAt) {
    await adminDb.collection('orders').doc(id).update({ 'leopards.deliveredAt': new Date().toISOString(), status: 'Completed' });
  }
  return t;
}
