/**
 * GET /api/public/invoice/:id?t=<key> → what the customer's invoice page shows: the invoice
 * (without the shop's own notes), the customer's address for the PDF, and the shop's name.
 *
 * The page read these straight from Firestore, which works only while the database is open
 * to anyone — as Taheri's was until 2026-09-30, and as Mina's never was, so every "View
 * estimate" link Mina sent a customer answered "an error occurred". The key (Invoice.shareToken,
 * lib/share-token.ts) is in the link the counter sends; the invoice number alone gets nothing,
 * since numbers run in order.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { isShareToken } from '@/lib/share-token';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const notFound = () => NextResponse.json({ error: 'This link is not valid.' }, { status: 404, headers });

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Row = Record<string, unknown>;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit('invoice', callerKey(req.headers), 120, 600);
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers });

  const { id } = await params;
  const key = req.nextUrl.searchParams.get('t');
  if (!id || !isShareToken(key)) return notFound();

  const snap = await adminDb.collection('invoices').doc(id).get();
  const inv = snap.data() as Row | undefined;
  if (!inv || typeof inv.shareToken !== 'string' || !same(inv.shareToken, key)) return notFound();

  const [customer, settings] = await Promise.all([
    typeof inv.customerId === 'string' && inv.customerId
      ? adminDb.collection('customers').doc(inv.customerId).get().then(d => d.data() as Row | undefined).catch(() => undefined)
      : Promise.resolve(undefined),
    adminDb.collection('app_settings').doc('global').get().then(d => d.data() as Row | undefined).catch(() => undefined),
  ]);

  // The shop's own words stay the shop's: the note on the sale, a piece's admin note, who is working on it —
  // and its margin: the 24k rate it was costed at (lib/margin.ts; the owner: "make sure the customer does
  // not get any of this info").
  const { internalNote: _note, shareToken: _key, costRate24k: _cost, sentOnWhatsApp: _sent, ...shown } = inv;
  const items = Array.isArray(inv.items) ? inv.items : Object.values((inv.items || {}) as Record<string, Row>);
  const cleanItems = (items as Row[]).map(({ adminNote: _a, karigarId: _k, givenAt: _g, isCompleted: _c, ...rest }) => rest);

  return NextResponse.json({
    invoice: { ...shown, id, items: cleanItems },
    customer: typeof customer?.address === 'string' && customer.address ? { address: customer.address } : null,
    shopName: typeof settings?.shopName === 'string' ? settings.shopName : null,
  }, { headers });
}
