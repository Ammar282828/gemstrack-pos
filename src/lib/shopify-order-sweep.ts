/**
 * The five-minute catch-up for House of Mina's Shopify orders (app/api/website/post/queue/tick). Shopify's notices
 * are the fast path, but they can be refused (from at least 2026-10-20 to 2026-11-02 every one was, signed by an
 * app whose secret the ERP doesn't hold: no web order reached the ERP on its own and no order WhatsApp went out).
 * So every tick also reads the last two days' orders from Shopify with the shop's own token and does what a notice
 * would have: imports one the ERP doesn't have, brings its payments up to date, starts its WhatsApp once, and thanks
 * a bank transfer once it is paid. Each step is idempotent (create-if-absent, `shopify_whatsapp` state moves once),
 * so the notice and the sweep can both run without anything happening twice.
 */

import { adminDb } from '@/lib/firebase-admin';
import { getShopifyCredentials, shopifyRequest } from '@/app/api/shopify/_lib';
import { mirrorShopifyOrderById } from '@/app/api/shopify/_order-mirror';
import { followUpPaidOrder, shopifyOrderWhatsAppOn, startOrderFlow } from '@/lib/shopify-whatsapp-server';

export async function sweepShopifyOrders(now = new Date()): Promise<{ seen: number; imported: string[]; whatsapp: string[]; errors: string[] } | null> {
  if (!shopifyOrderWhatsAppOn()) return null;
  let creds: { shop: string; token: string };
  try { creds = await getShopifyCredentials(adminDb); } catch { return null; }
  const since = new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString();
  const r = await shopifyRequest(creds.shop, creds.token, 'GET', `/orders.json?status=any&limit=50&updated_at_min=${encodeURIComponent(since)}`);
  const orders: { id: number; name?: string; order_number?: number }[] = r?.orders || [];
  const out = { seen: orders.length, imported: [] as string[], whatsapp: [] as string[], errors: [] as string[] };
  for (const o of orders) {
    const name = o.name || `#${o.order_number}`;
    try {
      const m = await mirrorShopifyOrderById(creds.shop, creds.token, String(o.id), { importIfAbsent: true });
      if ('imported' in m && m.imported) out.imported.push(name);
      const started = await startOrderFlow(o as never);
      if (started.started) out.whatsapp.push(`${name}: ${started.kind}`);
      if (await followUpPaidOrder(o as never)) out.whatsapp.push(`${name}: paid`);
    } catch (e) {
      out.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
