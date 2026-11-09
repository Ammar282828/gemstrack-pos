/**
 * GET /api/public/track?order=<#1460 | 1460 | SHOPIFY-1460 | ERP id>&phone=<the last 4 digits of the customer's phone>
 *   200 → { order: '#1460', name: 'Ayesha', status, state, carrier, cn, events: [{ at, status, location? }], url, checkedAt }
 *   404 → { error: 'No order matches' }   (no such order, or the digits do not match: the same answer, so neither leaks)
 *   429 → { error: 'Too many tries. Try again later.' }
 *
 * The website's "Track your order" (owner, 2026-11-09). The parcel's tracking is the ERP's own (lib/tracking-server.ts:
 * TCS, else Shopify's fulfilment events), shown to whoever knows the order number and the phone's last four digits.
 * Nothing of the customer beyond a first name: no address, no number, no amounts. Limited per caller (30 in 10 minutes)
 * and per order (30 an hour), so four digits cannot be walked. CORS: the house's shop (houseofmina.store and www,
 * NEXT_PUBLIC_STORE_SHOP_URL) and its website.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';
import { getShopifyCredentials, shopifyRequest } from '@/app/api/shopify/_lib';
import { askOf, getTracking } from '@/lib/tracking-server';
import { firstNameOf, parseOrderRef, phoneLast4, phoneMatches } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

function origins(): string[] {
  const list = new Set<string>(['https://houseofmina.store', 'https://www.houseofmina.store']);
  for (const v of [process.env.NEXT_PUBLIC_STORE_SHOP_URL, process.env.NEXT_PUBLIC_STORE_WEBSITE_URL, process.env.WEBSITE_ORIGIN]) {
    try {
      if (!v || !/^https?:\/\//.test(v)) continue;
      const o = new URL(v).origin;
      list.add(o);
      if (!/^https?:\/\/www\./.test(o)) list.add(o.replace('://', '://www.'));
    } catch { /* not an address */ }
  }
  if (process.env.NODE_ENV !== 'production') { list.add('http://localhost:5180'); list.add('http://localhost:3000'); }
  return [...list];
}

function cors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowed = origins();
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

const json = (req: NextRequest, body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { ...cors(req), 'Cache-Control': 'no-store' } });

export function OPTIONS(req: NextRequest) { return new NextResponse(null, { status: 204, headers: cors(req) }); }

type Doc = Record<string, unknown> & { id: string };
const NONE = { error: 'No order matches' };

async function find(ref: { shopifyNumber?: number; id?: string }): Promise<Doc | null> {
  const byId = async (col: string, id: string) => {
    if (!id || id.includes('/') || id.length > 200) return null;
    const s = await adminDb.collection(col).doc(id).get();
    return s.exists ? { ...(s.data() as Record<string, unknown>), id: s.id } : null;
  };
  const byNumber = async (col: string, n: number) => {
    const q = await adminDb.collection(col).where('shopifyOrderNumber', '==', n).limit(1).get();
    return q.empty ? null : { ...(q.docs[0].data() as Record<string, unknown>), id: q.docs[0].id };
  };
  if (ref.shopifyNumber) {
    return (await byId('orders', `SHOPIFY-${ref.shopifyNumber}`)) || (await byNumber('orders', ref.shopifyNumber)) || (await byNumber('invoices', ref.shopifyNumber));
  }
  return ref.id ? (await byId('orders', ref.id)) || (await byId('invoices', ref.id)) : null;
}

/** Every number the order knows its customer by; the Shopify order's own when the ERP has none. */
async function numbersOf(doc: Doc): Promise<string[]> {
  const delivery = doc.delivery as { contactPhone?: string } | undefined;
  const booking = doc.tcsBooking as { consignee?: { mobile?: string } } | undefined;
  const nums = [doc.customerContact, delivery?.contactPhone, booking?.consignee?.mobile].filter((n): n is string => typeof n === 'string' && !!n.trim());
  if (doc.shopifyOrderId) {
    try {
      const { shop, token } = await getShopifyCredentials(adminDb);
      const o = (await shopifyRequest(shop, token, 'GET', `/orders/${encodeURIComponent(String(doc.shopifyOrderId))}.json?fields=id,phone,shipping_address,billing_address,customer`))?.order;
      for (const n of [o?.phone, o?.shipping_address?.phone, o?.billing_address?.phone, o?.customer?.phone]) if (typeof n === 'string' && n.trim()) nums.push(n);
    } catch { /* the ERP's numbers only */ }
  }
  return nums;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const limit = await rateLimit('track', callerKey(req.headers), 30, 600);
  if (!limit.ok) return json(req, { error: 'Too many tries. Try again later.' }, 429);

  const ref = parseOrderRef(q.get('order'));
  const last4 = phoneLast4(q.get('phone'));
  if (!ref || !last4) return json(req, { error: 'Give the order number and the last 4 digits of your phone.' }, 400);
  const perOrder = await rateLimit('track-order', ref.shopifyNumber ? `n${ref.shopifyNumber}` : `i${ref.id}`, 30, 3600);
  if (!perOrder.ok) return json(req, { error: 'Too many tries. Try again later.' }, 429);

  try {
    const doc = await find(ref);
    if (!doc || !phoneMatches(await numbersOf(doc), last4)) return json(req, NONE, 404);
    const t = await getTracking(askOf(doc));
    const order = (typeof doc.shopifyOrderName === 'string' && doc.shopifyOrderName) || (doc.shopifyOrderNumber ? `#${doc.shopifyOrderNumber}` : doc.id);
    const cancelled = doc.status === 'Cancelled' || doc.status === 'Refunded';
    return json(req, {
      order,
      name: firstNameOf(doc.customerName as string),
      status: t?.status ?? (cancelled ? 'Cancelled' : 'Not shipped yet'),
      state: t?.state ?? (cancelled ? 'cancelled' : 'unfulfilled'),
      carrier: t?.carrier ?? null,
      cn: t?.cn ?? null,
      events: (t?.events ?? []).map(e => ({ at: e.at, status: e.status, ...(e.location ? { location: e.location } : {}) })),
      url: t?.url ?? null,
      ...(t?.deliveredAt ? { deliveredAt: t.deliveredAt } : {}),
      checkedAt: t?.checkedAt ?? new Date().toISOString(),
    });
  } catch (e) {
    console.error('[/api/public/track]', e);
    return json(req, { error: 'Tracking is not available right now. Try again in a minute.' }, 502);
  }
}
