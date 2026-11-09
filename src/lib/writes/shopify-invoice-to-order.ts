/**
 * An old Shopify sale (an invoice, from before Shopify's web orders became ERP orders) made an order (owner, 2026-11-09:
 * "FIX 2"): the pieces go to the workshop, the money already taken becomes the order's advances, and the sale counts as
 * revenue again when the order is finalized.
 *
 * The one copy, on the DbPort, run by /api/app/write `shopifyInvoicesToOrders` (the delete code is the route's to check).
 * For each invoice, in this order, so a crash in the middle is finished by the same call sent again:
 *  1. the order `SHOPIFY-<number>` (`SHOPIFY-INV-<invoice id>` with no number) is made through createOrder with a fixed id:
 *     the customer, a piece per unit, the discount, Shopify's ids and state (`shopifyTransactionIds` kept, so the mirror
 *     never adds a payment twice), the invoice's date, every payment an advance `adv-from-<invoice>-<payment id or index>`;
 *     it carries `convertedFromInvoiceId`, which is how a replay knows the order is its own;
 *  2. the invoice goes the way Delete invoice takes it (lib/writes/invoice-delete.ts: ledger rows, tombstone in
 *     `deleted_invoices`), without telling Shopify (the sale is not cancelled there) and without putting its pieces back in
 *     stock (they were Shopify's lines, never stock), logged as "converted to order".
 * An order that is already there and not this invoice's own is not overwritten: skipped, "already an order".
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { convertBlocker } from '@/lib/shopify-orders';
import { invoiceLines } from '@/lib/invoice-actions';
import { rupees } from '@/lib/money';
import { createOrder, type CreateOrderDeps } from './create-order';
import { deleteInvoice, type InvoiceDeleteDeps } from './invoice-delete';
import { orderBalance } from './order-pieces';

const INVOICES = 'invoices';
const ORDERS = 'orders';
const MAX_PIECES = 50;
/** Most invoices one call converts: each is a few round trips. */
export const MAX_CONVERT = 100;

export interface ConvertResult {
  converted: { invoiceId: string; orderId: string }[];
  skipped: { invoiceId: string; reason: string }[];
}

type Line = { sku?: string; name?: string; quantity?: number; unitPrice?: number; itemTotal?: number; metalType?: string; karat?: string; size?: string };
type InvoiceDoc = Record<string, unknown> & {
  id: string; customerId?: string; customerName?: string; customerContact?: string; createdAt?: string;
  items?: Line[] | Record<string, Line>; subtotal?: number; discountAmount?: number; grandTotal?: number; notes?: string;
  paymentHistory?: { id?: string; amount: number; date: string; method?: string; notes?: string }[];
  shopifyOrderId?: string | number; shopifyOrderNumber?: number | string; shopifyOrderName?: string;
  shopifyFinancialStatus?: string; shopifyFulfillment?: string; shopifyCancelledAt?: string; shopifyTransactionIds?: string[];
  whatsappOrder?: { state: string; at: string };
};

/** The id of the order this invoice becomes. */
export const orderIdForInvoice = (inv: { id: string; shopifyOrderNumber?: number | string }) =>
  Number(inv.shopifyOrderNumber) > 0 ? `SHOPIFY-${Number(inv.shopifyOrderNumber)}` : `SHOPIFY-INV-${inv.id}`;

/** The delete code's words for it, as the dialog says them and the log of tries records them. */
export const convertWhat = (ids: string[]) => ids.length === 1 ? `Make invoice ${ids[0]} an order` : `Make ${ids.length} Shopify invoices orders`;

/** A piece per unit, described as the invoice line was, priced at what the customer paid for it. */
export function piecesFromInvoice(inv: InvoiceDoc): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const l of invoiceLines<Line>(inv.items)) {
    const units = Math.min(Math.max(1, Number(l.quantity) || 1), MAX_PIECES);
    const price = rupees((Number(l.itemTotal) || Number(l.unitPrice) * units || 0) / units);
    for (let u = 0; u < units && out.length < MAX_PIECES; u++) {
      out.push({
        description: l.name || 'Shopify item',
        metalType: l.metalType || 'silver', ...(l.karat && { karat: l.karat }), ...(l.size && { size: l.size }),
        estimatedWeightG: 0, stoneWeightG: 0, hasStones: false, hasDiamonds: false, wastagePercentage: 0,
        makingCharges: price, diamondCharges: 0, stoneCharges: 0, totalEstimate: price,
        isManualPrice: true, manualPrice: price, sampleGiven: false, isCompleted: false,
      });
    }
  }
  if (!out.length) out.push({ description: 'Shopify order', metalType: 'silver', estimatedWeightG: 0, stoneWeightG: 0, hasStones: false, hasDiamonds: false, wastagePercentage: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, isCompleted: false });
  return out;
}

export interface ShopifyConvertDeps extends Omit<CreateOrderDeps, 'fixedId' | 'extra'> {
  deleteField: InvoiceDeleteDeps['deleteField'];
  by?: string;
}

export async function shopifyInvoicesToOrders(
  db: DbPort,
  invoiceIds: string[],
  deps: ShopifyConvertDeps,
  fx: SideEffects = {},
): Promise<ConvertResult> {
  const result: ConvertResult = { converted: [], skipped: [] };
  const { deleteField, by, ...orderDeps } = deps;

  for (const invoiceId of [...new Set(invoiceIds)]) {
    const inv = await db.get<InvoiceDoc>(INVOICES, invoiceId);
    if (!inv) {
      // Gone: either never there, or this very call made it an order before (a replay finishing).
      const done = await db.queryEquals<{ convertedFromInvoiceId?: string }>(ORDERS, 'convertedFromInvoiceId', invoiceId);
      if (done[0]) result.converted.push({ invoiceId, orderId: done[0].id });
      else result.skipped.push({ invoiceId, reason: 'no such invoice' });
      continue;
    }
    const blocker = convertBlocker(inv as never);
    if (blocker) { result.skipped.push({ invoiceId, reason: blocker }); continue; }

    const orderId = orderIdForInvoice(inv);
    const there = await db.get<{ convertedFromInvoiceId?: string }>(ORDERS, orderId);
    const byShopifyId = !there && inv.shopifyOrderId ? (await db.queryEquals(ORDERS, 'shopifyOrderId', String(inv.shopifyOrderId)))[0] : null;
    if ((there && there.convertedFromInvoiceId !== invoiceId) || byShopifyId) {
      result.skipped.push({ invoiceId, reason: 'already an order' });
      continue;
    }

    if (!there) {
      const payments = (inv.paymentHistory || []).filter(p => Number(p?.amount) > 0);
      const advances = payments.map((p, i) => ({
        id: `adv-from-${invoiceId}-${p.id || i}`.slice(0, 120),
        amount: rupees(p.amount), date: p.date || inv.createdAt || new Date().toISOString(),
        ...(p.method && { method: p.method }), ...(p.notes && { notes: p.notes }),
      }));
      const paid = rupees(advances.reduce((s, a) => s + a.amount, 0));
      const discount = rupees(inv.discountAmount);
      const full = rupees(inv.grandTotal);
      const subtotal = full + discount;
      await createOrder(db, {
        items: piecesFromInvoice(inv) as { description?: string }[],
        source: 'shopify',
        customerId: inv.customerId, customerName: inv.customerName, customerContact: inv.customerContact,
        subtotal, discountAmount: discount, advancePayment: paid, advances,
        grandTotal: orderBalance({ subtotal, discountAmount: discount, advancePayment: paid }),
        notes: [inv.shopifyOrderName ? `Shopify order ${inv.shopifyOrderName}` : '', inv.notes, `Made an order from invoice ${invoiceId}`].filter(Boolean).join(' · '),
      }, {
        ...orderDeps,
        fixedId: orderId,
        extra: {
          createdAt: inv.createdAt || new Date().toISOString(),
          convertedFromInvoiceId: invoiceId,
          ...(inv.shopifyOrderId !== undefined && { shopifyOrderId: String(inv.shopifyOrderId) }),
          ...(inv.shopifyOrderNumber !== undefined && { shopifyOrderNumber: Number(inv.shopifyOrderNumber) || undefined }),
          shopifyOrderName: inv.shopifyOrderName || (inv.shopifyOrderNumber ? `#${inv.shopifyOrderNumber}` : undefined),
          shopifyFinancialStatus: String(inv.shopifyFinancialStatus || ''),
          shopifyFulfillment: String(inv.shopifyFulfillment || 'unfulfilled'),
          shopifyTransactionIds: (inv.shopifyTransactionIds || []).map(String),
          ...(inv.whatsappOrder && { whatsappOrder: inv.whatsappOrder }),
          advancePayment: paid,
        },
      }, { ...fx, notify: undefined, log: undefined });
    }

    // The same removal as Delete invoice. Every sku counts as sold elsewhere, so nothing goes back in stock.
    const removed = await deleteInvoice(db, { invoiceId, syncShopify: false, by }, {
      deleteField,
      invoices: () => [{ id: `converted:${invoiceId}`, items: inv.items }],
    }, { ...fx, log: undefined, notify: undefined, shopify: undefined });
    if (!removed.deleted) { result.skipped.push({ invoiceId, reason: 'no such invoice' }); continue; }
    result.converted.push({ invoiceId, orderId });
    await Promise.resolve(fx.log?.('order.create', `Converted to order: ${orderId}`, `Invoice ${invoiceId} (${inv.customerName || 'Walk-in'}) made an order · ${removed.ledgerRows} ledger row(s) removed`, orderId)).catch(() => undefined);
  }
  return result;
}
