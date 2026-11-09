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
import { deliveryOf } from '@/lib/shopify-delivery';
import { codTransactionId, withDeliveredCod } from '@/lib/shopify-mirror';
import { ensureShopifyWebhooks } from '@/lib/shopify-webhooks';
import { STORE_SHOPIFY_SECTION } from '@/lib/store-config';

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

/** What the ERP holds of a Shopify order, for the catch-up's "is it behind?" (an order or an invoice alike). */
export interface ErpShopifyRecord {
  shopifyFulfillment?: string;
  shopifyFinancialStatus?: string;
  shopifyCancelledAt?: string;
  shopifyDelivery?: string;
  shopifyTransactionIds?: string[];
}

/** Shopify's order as listed (orders.json): enough to tell whether the ERP's copy is behind without reading it again. */
export interface ListedShopifyOrder extends ShopifyOrderStateLike {
  id: number | string;
  order_number?: number | string;
  name?: string;
}
type ShopifyOrderStateLike = Parameters<typeof deliveryOf>[0] & { financial_status?: string | null; total_price?: string | number | null; current_total_price?: string | number | null };

/** True when the ERP's copy says something other than Shopify does now: paid, shipped, where the parcel is, cancelled. */
export function isBehind(erp: ErpShopifyRecord, o: ListedShopifyOrder): boolean {
  return (erp.shopifyFulfillment || '') !== String(o.fulfillment_status || 'unfulfilled')
    || (erp.shopifyFinancialStatus || '') !== String(o.financial_status || '')
    || !!erp.shopifyCancelledAt !== !!o.cancelled_at
    || (erp.shopifyDelivery || '') !== deliveryOf(o).delivery
    // Delivered cash on delivery not yet taken as paid (lib/shopify-mirror.ts withDeliveredCod).
    || (withDeliveredCod(o, []).length > 0 && !(erp.shopifyTransactionIds || []).map(String).includes(codTransactionId(o.id)));
}

/** How often the whole catch-up runs (the safety net under Shopify's live notices), and how many orders it brings up to date in one tick (two Shopify reads each). */
const DELIVERY_EVERY_MS = 10 * 60 * 1000;
const DELIVERY_PER_TICK = 40;

/**
 * Every ten minutes (under Shopify's live notices, which do the work in seconds), the last four months of Shopify orders against the ERP (owner, 2026-11-09: "a lot of the shopify
 * orders on erp have been fulfilled or returned; update them"). TCS's tracking reaches Shopify as the fulfilment's
 * shipment status, which does not always send the ERP a notice, and the two-day sweep above only sees orders changed
 * lately: so here every web order the ERP has (as an order or an invoice) is compared with Shopify's list, and each one
 * behind is mirrored (paid, shipped → Completed, delivered, returned → Cancelled when nothing was paid). At most
 * DELIVERY_PER_TICK a tick; until it has caught up it runs again at the next tick.
 */
export async function catchUpShopifyDelivery(now = new Date()): Promise<{ checked: number; behind: number; mirrored: string[]; errors: string[] } | null> {
  if (!STORE_SHOPIFY_SECTION) return null;
  const stateRef = adminDb.collection('shopify_sync').doc('delivery');
  // Shopify's live notices (orders, and each parcel's TCS update) kept registered, once a day.
  await keepNoticesRegistered(now).catch(e => console.error('[shopify] notices', e instanceof Error ? e.message : String(e)));
  const last = (await stateRef.get()).data()?.at as string | undefined;
  if (last && now.getTime() - Date.parse(last) < DELIVERY_EVERY_MS) return null;
  let creds: { shop: string; token: string };
  try { creds = await getShopifyCredentials(adminDb); } catch { return null; }

  const since = new Date(now.getTime() - 120 * 24 * 3600 * 1000).toISOString();
  const fields = 'id,order_number,name,cancelled_at,fulfillment_status,financial_status,fulfillments,total_price,current_total_price';
  const r = await shopifyRequest(creds.shop, creds.token, 'GET', `/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}&fields=${fields}`);
  const listed: ListedShopifyOrder[] = r?.orders || [];

  // The ERP's copies by Shopify's order name (#1460): the section's orders and the web sales kept as invoices.
  const [orders, apiInv, csvInv] = await Promise.all([
    adminDb.collection('orders').where('source', '==', 'shopify').get(),
    adminDb.collection('invoices').where('source', '==', 'shopify').get(),
    adminDb.collection('invoices').where('source', '==', 'shopify_import').get(),
  ]);
  const erp = new Map<string, ErpShopifyRecord>();
  for (const d of [...apiInv.docs, ...csvInv.docs, ...orders.docs]) {
    const v = d.data() as ErpShopifyRecord & { shopifyOrderName?: string };
    const name = v.shopifyOrderName || (d.id.startsWith('SHOPIFY-') ? `#${d.id.slice(8)}` : '');
    if (name) erp.set(name, v); // an order after its invoice: the order is what the section shows
  }

  const behind = listed.filter(o => { const e = erp.get(o.name || `#${o.order_number}`); return !!e && isBehind(e, o); });
  const out = { checked: listed.length, behind: behind.length, mirrored: [] as string[], errors: [] as string[] };
  for (const o of behind.slice(0, DELIVERY_PER_TICK)) {
    const name = o.name || `#${o.order_number}`;
    try {
      const m = await mirrorShopifyOrderById(creds.shop, creds.token, String(o.id));
      if (!('skipped' in m) && m.changed) out.mirrored.push(name);
    } catch (e) {
      out.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Rest ten minutes unless a whole batch changed (then more are waiting: the next tick carries on). One the mirror
  // cannot move (the ERP's own pushed order, an invoiced order's state) never keeps it running every five minutes.
  if (out.mirrored.length < DELIVERY_PER_TICK) await stateRef.set({ at: now.toISOString(), checked: out.checked, behind: out.behind, mirrored: out.mirrored.length, errors: out.errors.slice(0, 10) });
  return out;
}

/** Once a day: every notice the ERP needs points at it (lib/shopify-webhooks.ts); what Shopify refuses is kept with the state. */
async function keepNoticesRegistered(now: Date) {
  const ref = adminDb.collection('shopify_sync').doc('webhooks');
  const last = (await ref.get()).data()?.at as string | undefined;
  if (last && now.getTime() - Date.parse(last) < 24 * 3600 * 1000) return;
  const creds = await getShopifyCredentials(adminDb);
  const r = await ensureShopifyWebhooks(creds.shop, creds.token);
  await ref.set({ at: now.toISOString(), ...r });
  if (r.registered.length || r.refused.length) console.log('[shopify] notices', JSON.stringify(r));
}
