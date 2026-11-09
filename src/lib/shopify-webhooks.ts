/**
 * The notices Shopify sends the ERP, kept registered by the ERP itself (owner, 2026-11-09: the Shopify setting is gone,
 * "it is all automatic now"; "the tcs connection should be live so if any tcs update comes it gets automatically updated").
 *
 * - orders/create, orders/updated: a web order arrives, is paid, shipped or cancelled.
 * - fulfillments/create, fulfillments/update: a parcel is booked with TCS (Universal Courier), and each TCS update to it
 *   (in transit, out for delivery, delivered, not delivered) as it happens. These need the app's read_fulfillments scope;
 *   where Shopify refuses them they are reported (`refused`) and the ten-minute catch-up carries the TCS state instead.
 *
 * All go to /api/shopify/webhooks/orders, which reads the order back from Shopify and mirrors it. Idempotent: a notice
 * already pointing here is left alone. Run once a day by the five-minute tick (lib/shopify-order-sweep.ts) and by
 * POST /api/shopify/register-webhooks.
 */

import { APP_URL, SHOPIFY_API_VERSION } from '@/app/api/shopify/_lib';

export const NOTICE_TOPICS = ['orders/create', 'orders/updated', 'fulfillments/create', 'fulfillments/update'] as const;

export const noticeAddress = () => `${APP_URL}/api/shopify/webhooks/orders`;

export async function ensureShopifyWebhooks(shop: string, token: string): Promise<{ registered: string[]; skipped: string[]; refused: { topic: string; error: string }[] }> {
  const base = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`;
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
  const res = await fetch(base, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Shopify webhooks: ${res.status}`);
  const existing = ((await res.json()).webhooks || []) as { topic: string; address: string }[];
  const address = noticeAddress();
  const out = { registered: [] as string[], skipped: [] as string[], refused: [] as { topic: string; error: string }[] };
  for (const topic of NOTICE_TOPICS) {
    if (existing.some(w => w.topic === topic && w.address === address)) { out.skipped.push(topic); continue; }
    const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ webhook: { topic, address, format: 'json' } }), signal: AbortSignal.timeout(15000) });
    if (r.ok) out.registered.push(topic);
    else out.refused.push({ topic, error: `${r.status} ${JSON.stringify(await r.json().catch(() => ({}))).slice(0, 200)}` });
  }
  return out;
}

/** The Shopify order a notice is about: an order's own id, or a parcel's `order_id` (fulfillments/*). */
export function noticeOrderId(topic: string, rawBody: string): string | null {
  try {
    const body = JSON.parse(rawBody);
    const id = String((topic.startsWith('fulfillments/') ? body?.order_id : body?.id) ?? '');
    return /^\d{1,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
