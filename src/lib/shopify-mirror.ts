/**
 * A web order's life after it is in the ERP: what Shopify says happened to it since — paid, shipped,
 * cancelled — carried onto its invoice, and nothing else.
 *
 * Found 2026-10-06 (House of Mina): every Shopify notice since at least 2026-09-06 had been refused
 * (401). The ERP checked them against the secret of a different Shopify app than the one ("HOM POS")
 * whose token registered them, so the web orders froze as they were pulled in: of 47, 45 were behind —
 * 5 paid on Shopify (Rs 95,300) still owed, 40 shipped still waiting in the Workshop, 3 cancelled
 * (Rs 32,550) still sales. The old handler would not have been better working: it rewrote the whole
 * invoice from Shopify on every update — `paymentHistory: []`, every piece gold 21k — and 183 of the
 * 187 web invoices carry what the shop added (160 a payment, 34 a karigar).
 *
 * So the rule:
 * - The ERP's invoice is the shop's record. Shopify adds to it, never replaces it: its successful
 *   payments (sale, capture) become payments, each once (by Shopify's transaction id), and only up to
 *   what is still owed — a payment the counter already took by hand is not taken twice.
 * - Payment, fulfilment and cancellation are kept as Shopify's own words (`shopifyFinancialStatus`,
 *   `shopifyFulfillment`, `shopifyCancelledAt`); the Workshop reads them. A web sale cancelled there
 *   with nothing paid is voided (MirrorPlan.voids).
 * - A Shopify payment is never Cash: the drawer is the Cash in it (lib/analytics/todays-cash.ts), and
 *   a courier's COD or a card online never passes through it.
 * - Refunds are not mirrored: what the shop gives back it records itself (refundInvoicePartial).
 */

import type { Payment, PaymentType } from '@/lib/store';

export interface ShopifyTransaction {
  id: number | string;
  kind?: string;
  status?: string;
  amount?: string | number;
  gateway?: string;
  processed_at?: string;
  created_at?: string;
}

export interface ShopifyOrderState {
  id: number | string;
  order_number?: number | string;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
}

export interface MirroredInvoice {
  grandTotal?: number;
  amountPaid?: number;
  paymentHistory?: Payment[];
  shopifyTransactionIds?: string[];
  shopifyFinancialStatus?: string;
  shopifyFulfillment?: string;
  shopifyCancelledAt?: string;
  status?: string;
}

/** How Shopify's gateway reaches the shop: never the drawer. */
export function shopifyPaymentMethod(gateway: string | undefined): PaymentType | undefined {
  const g = String(gateway || '').toLowerCase();
  if (/safepay|card|stripe|paypal|shopify_payments/.test(g)) return 'Card';
  // Cash on delivery is collected by the courier and paid into the bank with the rest of the week's.
  if (/bank|transfer|deposit|cash on delivery|\bcod\b/.test(g)) return 'Bank Transfer';
  return undefined; // "manual" (marked paid by hand on Shopify): how is not known
}

export const shopifyPaymentNote = (orderNumber: unknown, gateway?: string) =>
  `Paid on Shopify (Order #${orderNumber}${gateway && gateway !== 'manual' ? `, ${gateway}` : ''})`;

const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

export interface MirrorPlan {
  /** Payments to add, in the order Shopify took them. Only with some are the next three written. */
  added: Payment[];
  paymentHistory: Payment[];
  amountPaid: number;
  balanceDue: number;
  /** Shopify's state, to write as it is. */
  fields: { shopifyFinancialStatus: string; shopifyFulfillment: string; shopifyCancelledAt?: string; shopifyTransactionIds: string[] };
  /**
   * A web sale cancelled on Shopify with nothing paid never happened: it is voided — `status:
   * 'Refunded'`, the ERP's one "not a sale" (Owed, Analytics and the Workshop all leave it out).
   * With money taken it is only marked: what goes back is a person's to record.
   */
  voids: boolean;
  /** False when there is nothing to write. */
  changed: boolean;
}

/** What Shopify's order and its transactions add to the invoice. Pure: the write is writes/invoice-payment.ts. */
export function planShopifyMirror(
  inv: MirroredInvoice,
  order: ShopifyOrderState,
  transactions: ShopifyTransaction[],
  /** Only a web sale's own invoice: a checkout link's invoice was a sale at the counter first. */
  opts: { voidWhenCancelled?: boolean } = {},
): MirrorPlan {
  const seen = (inv.shopifyTransactionIds || []).map(String);
  const known = new Set(seen);
  const paymentHistory = [...(inv.paymentHistory || [])];
  const grand = Number(inv.grandTotal) || 0;
  // What the history accounts for decides what a Shopify payment may fill; what is paid never goes
  // down. A web order pulled in as paid carries the amount and no payments (mapInvoice), so its
  // Shopify payment is added as the record of it — dated, by method — and Cash In finally sees it;
  // one the counter already took is not added again.
  let documented = paymentHistory.reduce((s, p) => s + (Number(p?.amount) || 0), 0);
  const stored = Number(inv.amountPaid) || 0;
  const added: Payment[] = [];

  const taken = (transactions || [])
    .filter(t => t && t.status === 'success' && (t.kind === 'sale' || t.kind === 'capture'))
    .sort((a, b) => String(a.processed_at || a.created_at || '').localeCompare(String(b.processed_at || b.created_at || '')));
  for (const t of taken) {
    const id = String(t.id);
    if (known.has(id)) continue;
    known.add(id);
    seen.push(id);
    const amount = Math.min(money(t.amount), money(grand - documented));
    if (amount < 1) continue; // already settled at the counter: seen, not added
    const method = shopifyPaymentMethod(t.gateway);
    const payment: Payment = {
      amount,
      date: t.processed_at || t.created_at || new Date().toISOString(),
      notes: shopifyPaymentNote(order.order_number, t.gateway),
      ...(method && { method }),
      reference: `Shopify #${order.order_number}`,
    };
    paymentHistory.push(payment);
    added.push(payment);
    documented += amount;
  }
  const paid = Math.max(stored, documented);

  const fields: MirrorPlan['fields'] = {
    shopifyFinancialStatus: String(order.financial_status || ''),
    shopifyFulfillment: String(order.fulfillment_status || 'unfulfilled'),
    ...(order.cancelled_at && { shopifyCancelledAt: String(order.cancelled_at) }),
    shopifyTransactionIds: seen,
  };
  const voids = !!opts.voidWhenCancelled && !!order.cancelled_at && inv.status !== 'Refunded' && paid < 1;
  const changed = voids || added.length > 0
    || seen.length !== (inv.shopifyTransactionIds || []).length
    || fields.shopifyFinancialStatus !== (inv.shopifyFinancialStatus || '')
    || fields.shopifyFulfillment !== (inv.shopifyFulfillment || '')
    || (fields.shopifyCancelledAt || '') !== (inv.shopifyCancelledAt || '');

  return { added, paymentHistory, amountPaid: money(paid), balanceDue: money(grand - paid), fields, voids, changed };
}

/** Orders the ERP pushed out itself (pos-import): the ERP's invoice is the record, Shopify's copy an echo. */
export function isPosPushedOrder(order: { tags?: string | string[] | null }): boolean {
  const tags = (Array.isArray(order.tags) ? order.tags : String(order.tags || '').split(','))
    .map(t => String(t).trim()).filter(Boolean);
  return tags.includes('pos-import') || tags.some(t => t.startsWith('pos-inv-'));
}

/** The ERP invoice a checkout link was made for ("POS Invoice INV-000123" in the note). */
export const paymentLinkInvoiceId = (order: { note?: string | null }) =>
  /POS Invoice (INV-\d+)/.exec(String(order.note || ''))?.[1] || null;
