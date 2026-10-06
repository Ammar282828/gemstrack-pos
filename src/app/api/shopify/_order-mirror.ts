/**
 * One Shopify order, read fresh from Shopify, onto the invoice the ERP already has for it
 * (lib/shopify-mirror.ts has the rule). Used by the orders notice and by
 * scripts/shopify-mirror-orders.ts, which brings every imported web order up to date at once.
 *
 * Which invoice:
 * - an order the ERP pushed out itself (pos-import): none — the ERP's invoice is the record. Its
 *   note says "POS Invoice INV-…" too, and the old handler took that for a paid checkout link and
 *   marked the invoice paid in full whenever Shopify touched the order (INV-000228, Rs 29,000 owed,
 *   was one Shopify edit from it);
 * - a checkout link's order (the note, no pos-import tag): the INV- invoice it was made for;
 * - any other: SHOPIFY-<number>, the invoice Settings → Shopify's pull made for it. An order not
 *   pulled yet is left for the pull: what comes in from the website is chosen there, as it has been.
 */

import { adminPort } from '@/lib/db-admin-port';
import { adminDb } from '@/lib/firebase-admin';
import { isPosPushedOrder, paymentLinkInvoiceId, type ShopifyTransaction } from '@/lib/shopify-mirror';
import { mirrorShopifyOrder, type ShopifyMirrorResult } from '@/lib/writes/invoice-payment';
import { shopifyRequest } from './_lib';

export type OrderMirrorOutcome =
  | { skipped: 'gone' | 'pos-push' | 'not-imported'; order?: string }
  | (ShopifyMirrorResult & { order: string });

/** The ERP invoice for this Shopify order, or why there is none. */
export async function invoiceForShopifyOrder(order: { id: number | string; order_number?: number | string; note?: string | null; tags?: string | null }):
  Promise<{ invoiceId: string; extra: Record<string, unknown>; webSale: boolean } | { skipped: 'pos-push' | 'not-imported' }> {
  if (isPosPushedOrder(order)) return { skipped: 'pos-push' };
  const linked = paymentLinkInvoiceId(order);
  if (linked) {
    return (await adminDb.collection('invoices').doc(linked).get()).exists
      ? { invoiceId: linked, extra: { shopifyOrderId: String(order.id), shopifyOrderNumber: order.order_number ?? null }, webSale: false }
      : { skipped: 'not-imported' };
  }
  const byNumber = `SHOPIFY-${order.order_number}`;
  if ((await adminDb.collection('invoices').doc(byNumber).get()).exists) return { invoiceId: byNumber, extra: {}, webSale: true };
  const byId = await adminDb.collection('invoices').where('shopifyOrderId', '==', String(order.id)).where('source', '==', 'shopify').limit(1).get();
  return byId.empty ? { skipped: 'not-imported' } : { invoiceId: byId.docs[0].id, extra: {}, webSale: true };
}

export async function fetchShopifyOrder(shop: string, token: string, orderId: string) {
  try {
    const r = await shopifyRequest(shop, token, 'GET', `/orders/${orderId}.json`);
    return r?.order || null;
  } catch (e) {
    if (/: 404\b/.test(String((e as Error)?.message))) return null;
    throw e;
  }
}

export async function fetchShopifyTransactions(shop: string, token: string, orderId: string): Promise<ShopifyTransaction[]> {
  const r = await shopifyRequest(shop, token, 'GET', `/orders/${orderId}/transactions.json`);
  return r?.transactions || [];
}

// The activity log's own shape (store.ts addActivityLog), so the entry shows where the owner reads it.
const log = async (action: string, title: string, detail: string, relatedId?: string) => {
  await adminDb.collection('activity_log').add({
    timestamp: new Date().toISOString(), eventType: action, description: title, details: detail,
    entityId: relatedId || '', via: 'shopify',
  });
};

/** Read the order from Shopify and carry it onto its invoice. */
export async function mirrorShopifyOrderById(shop: string, token: string, orderId: string): Promise<OrderMirrorOutcome> {
  const order = await fetchShopifyOrder(shop, token, orderId);
  if (!order) return { skipped: 'gone' };
  const name = `#${order.order_number}`;
  const target = await invoiceForShopifyOrder(order);
  if ('skipped' in target) return { skipped: target.skipped, order: name };
  const transactions = await fetchShopifyTransactions(shop, token, String(order.id));
  const result = await mirrorShopifyOrder(adminPort, target.invoiceId, order, transactions, target.extra, { log }, { voidWhenCancelled: target.webSale });
  return result ? { ...result, order: name } : { skipped: 'not-imported', order: name };
}
