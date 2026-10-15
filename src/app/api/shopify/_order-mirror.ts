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
 * - any other: SHOPIFY-<number>, the invoice the pull made for it. An order not in yet is imported by
 *   `importShopifyOrder` — the pull's own code — when its create/updated notice arrives (2026-10-15);
 *   the pull (Settings → Shopify → Import) stays for catch-up.
 */

import { adminPort } from '@/lib/db-admin-port';
import { adminDb } from '@/lib/firebase-admin';
import { isPosPushedOrder, paymentLinkInvoiceId, type ShopifyTransaction } from '@/lib/shopify-mirror';
import { mirrorShopifyOrder, type ShopifyMirrorResult } from '@/lib/writes/invoice-payment';
import { mapInvoice, shopifyRequest } from './_lib';

/** Who and how much, for the shop's notification (lib/push/send.ts). */
export interface OrderGist { name: string; customer: string; total: string }

export type OrderMirrorOutcome =
  | { skipped: 'gone' | 'pos-push' | 'not-imported'; order?: string; gist?: OrderGist }
  | (ShopifyMirrorResult & { order: string; gist?: OrderGist; imported?: boolean });

/** Only orders placed after this Shopify order number are imported; everything below predates the ERP
 *  and is deliberately not backfilled (the pull's cutoff, shared by the notice). */
export const SINCE_ORDER_NUMBER = 1381;

/**
 * Import ONE Shopify order as its SHOPIFY-<number> invoice: the pull's code path for a single order
 * (mapInvoice, no customer write — customers come in by their own pull). Shared by the pull and the
 * orders notice.
 * - `force` (the pull, where a person ticked the order): write over/merge as the pull always did;
 * - otherwise create-if-absent in one transaction, so two notices arriving together (each goes to two
 *   addresses) or a retry cannot double-create. "Absent" means no invoice at SHOPIFY-<n>, none carrying
 *   this Shopify order id, and no earlier CSV import of `#<n>`.
 * Returns whether it wrote.
 */
export async function importShopifyOrder(order: { id: number | string; order_number?: number | string }, opts: { force?: boolean } = {}): Promise<boolean> {
  const invoices = adminDb.collection('invoices');
  const doc = invoices.doc(`SHOPIFY-${order.order_number}`);
  if (opts.force) { await doc.set(mapInvoice(order), { merge: true }); return true; }
  return adminDb.runTransaction(async t => {
    if ((await t.get(doc)).exists) return false;
    if (!(await t.get(invoices.where('shopifyOrderId', '==', String(order.id)).limit(1))).empty) return false;
    if (!(await t.get(invoices.where('shopifyOrderName', '==', `#${order.order_number}`).limit(1))).empty) return false;
    t.set(doc, mapInvoice(order));
    return true;
  });
}

function gistOf(order: { order_number?: number | string; total_price?: string | number; currency?: string; customer?: { first_name?: string; last_name?: string } | null; billing_address?: { name?: string } | null }): OrderGist {
  const c = order.customer;
  const customer = [c?.first_name, c?.last_name].filter(Boolean).join(' ') || order.billing_address?.name || '';
  const total = `${order.currency || 'PKR'} ${Math.round(Number(order.total_price) || 0).toLocaleString('en-PK')}`;
  return { name: `#${order.order_number}`, customer, total };
}

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
export async function mirrorShopifyOrderById(shop: string, token: string, orderId: string, opts: { importIfAbsent?: boolean } = {}): Promise<OrderMirrorOutcome> {
  const order = await fetchShopifyOrder(shop, token, orderId);
  if (!order) return { skipped: 'gone' };
  const name = `#${order.order_number}`;
  const gist = gistOf(order);
  let target = await invoiceForShopifyOrder(order);
  let imported = false;
  if ('skipped' in target && target.skipped === 'not-imported' && opts.importIfAbsent
    && !paymentLinkInvoiceId(order) && Number(order.order_number) > SINCE_ORDER_NUMBER) {
    imported = await importShopifyOrder(order);
    target = await invoiceForShopifyOrder(order);
  }
  if ('skipped' in target) return { skipped: target.skipped, order: name, gist };
  const transactions = await fetchShopifyTransactions(shop, token, String(order.id));
  const result = await mirrorShopifyOrder(adminPort, target.invoiceId, order, transactions, target.extra, { log }, { voidWhenCancelled: target.webSale });
  return result ? { ...result, order: name, gist, ...(imported && { imported }) } : { skipped: 'not-imported', order: name, gist };
}
