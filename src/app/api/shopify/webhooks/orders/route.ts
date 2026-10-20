import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getShopifyCredentials, webhookResourceId } from '../../_lib';
import { adminDb } from '@/lib/firebase-admin';
import { mirrorShopifyOrderById, type OrderMirrorOutcome } from '../../_order-mirror';
import { pushToShop } from '@/lib/push/send';

/**
 * The shop's iPhones (lib/push/send.ts): a new web order as it arrives, before anyone pulls it in,
 * and a payment Shopify took onto an invoice. Once each, however often Shopify says so.
 */
async function pushFor(topic: string, orderId: string, o: OrderMirrorOutcome) {
  const g = o.gist;
  if (!g || ('skipped' in o && o.skipped === 'pos-push')) return;
  const body = [g.name, g.customer, g.total].filter(Boolean).join(' · ');
  if (topic === 'orders/create') await pushToShop({ kind: 'orders', title: 'New Shopify order', body, url: '/settings/integrations', key: `shopify-order_${orderId}` });
  if ('added' in o && o.added.length) {
    const paid = o.added.reduce((t, p) => t + (Number(p.amount) || 0), 0);
    await pushToShop({
      kind: 'payments', title: 'Paid on Shopify',
      body: [g.name, g.customer, `PKR ${Math.round(paid).toLocaleString('en-PK')}`].filter(Boolean).join(' · '),
      url: `/invoices/${encodeURIComponent(o.invoiceId)}`, key: `shopify-paid_${orderId}_${o.added.map((p) => p.date).join('_')}`,
    });
  }
}

/**
 * orders/create and orders/updated: what Shopify says happened to a web order since it was pulled
 * in — paid, shipped, cancelled — onto its invoice (app/api/shopify/_order-mirror.ts).
 *
 * The notice is only told which order; the order itself is read back from Shopify with the shop's
 * own token. So nothing in the body is trusted and no signing secret is needed: until 2026-10-06
 * every notice was refused for one, signed by the "HOM POS" app and checked against another app's
 * secret, and the ERP's web orders froze as they were pulled. Reading it back also means notices
 * arriving out of order, or twice (Mina's store sends each to two addresses), all end in Shopify's
 * latest word.
 */
/**
 * X-Shopify-Hmac-Sha256 = base64 HMAC-SHA256 of the raw body with the app's API secret (SHOPIFY_API_SECRET).
 * Checked only when that secret is available at run time; with none (today: Taheri sets none, Mina's is
 * build-only) it says so in the log and accepts, as before, since a wrong app's secret once froze the orders.
 * Add the secret with availability RUNTIME to turn the check on.
 */
function signatureOk(raw: string, header: string | null): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) { console.warn('[shopify/webhooks/orders] no SHOPIFY_API_SECRET at run time: notice not verified'); return true; }
  if (!header) return false;
  const want = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest();
  const got = Buffer.from(header, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!signatureOk(raw, request.headers.get('x-shopify-hmac-sha256'))) {
    console.warn('[shopify/webhooks/orders] bad signature, refused');
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }
  const orderId = webhookResourceId(raw);
  if (!orderId) return NextResponse.json({ ok: true, skipped: 'no-order-id' });

  let creds: { shop: string; token: string };
  try { creds = await getShopifyCredentials(adminDb); } catch { return NextResponse.json({ ok: true, skipped: 'not-connected' }); }

  try {
    const topic = String(request.headers.get('x-shopify-topic') || '');
    // A new web order arrives on its own (2026-10-15): create/updated import it when the ERP has none.
    const outcome = await mirrorShopifyOrderById(creds.shop, creds.token, orderId, { importIfAbsent: topic === 'orders/create' || topic === 'orders/updated' });
    await pushFor(topic, orderId, outcome);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    // A failure answers 500, so Shopify sends it again later.
    console.error('[shopify/webhooks/orders]', orderId, (e as Error)?.message);
    return NextResponse.json({ error: 'mirror failed' }, { status: 500 });
  }
}
