/**
 * GET /api/app/courier?order=<id> | ?invoice=<id>
 *   → { booking: { connected, ready, originCity }, prefill: BookingPrefill, cities: string[], booked: TcsBooking | null }
 *
 * What the order page's "Book with TCS" form starts with (lib/tcs-booking.ts): the Shopify order's shipping address when
 * there is one, else the order's delivery, else its notes; the cash to collect is what is still owed. `cities` is TCS's
 * list (a day old at most) for the city field, empty until TCS opens the account. Owners and staff.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { pdfViewer, isDocId } from '@/lib/app-pdf';
import { getShopifyCredentials, shopifyRequest } from '@/app/api/shopify/_lib';
import { codReady } from '@/lib/tcs-payments';
import { tcsCredentials } from '@/lib/tcs-payments-server';
import { tcsCities } from '@/lib/tcs-cod-server';
import { prefillBooking, type BookableDoc, type ShopifyShipTo, type TcsBooking } from '@/lib/tcs-booking';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const orderId = q.get('order') || '', invoiceId = q.get('invoice') || '';
  const id = orderId || invoiceId;
  if (!isDocId(id) || (orderId && invoiceId)) return NextResponse.json({ error: 'Which order or invoice?' }, { status: 400 });
  const snap = await adminDb.collection(orderId ? 'orders' : 'invoices').doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const doc = { ...(snap.data() as BookableDoc & { tcsBooking?: TcsBooking }), id: snap.id };

  let ship: ShopifyShipTo | null = null, email: string | null = null;
  if (doc.shopifyOrderId) {
    try {
      const { shop, token } = await getShopifyCredentials(adminDb);
      const o = (await shopifyRequest(shop, token, 'GET', `/orders/${encodeURIComponent(String(doc.shopifyOrderId))}.json?fields=id,shipping_address,email,contact_email,phone`))?.order;
      ship = o?.shipping_address || null;
      email = o?.email || o?.contact_email || null;
      if (ship && !ship.phone && o?.phone) ship = { ...ship, phone: o.phone };
    } catch (e) {
      console.warn('[/api/app/courier] Shopify address', doc.shopifyOrderId, e instanceof Error ? e.message : e);
    }
  }
  const c = await tcsCredentials().catch(() => null);
  const ready = codReady(c);
  const cities = ready ? await tcsCities().catch(() => [] as string[]) : [];
  return NextResponse.json({
    booking: { connected: !!c, ready, originCity: c?.originCity || 'Karachi' },
    prefill: prefillBooking(doc, orderId ? 'order' : 'invoice', ship, email),
    cities,
    booked: doc.tcsBooking && !doc.tcsBooking.cancelledAt ? doc.tcsBooking : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
