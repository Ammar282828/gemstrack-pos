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
import { convertBlocker, type ConvertibleInvoice } from '@/lib/shopify-orders';
import { isShippedOut } from '@/lib/shopify-delivery';
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
          // The invoice's extra beyond its lines was Shopify's delivery: named on the order, carried back at Finalize.
          ...(rupees(inv.adjustmentsAmount as number) > 0 && { deliveryCharge: rupees(inv.adjustmentsAmount as number) }),
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

/**
 * Every old Shopify sale an order (owner, 2026-11-09: "convert all shopify orders into orders, and deal with them properly:
 * if they were completed they were just completed orders, if not they are in workshop").
 * - Open (nothing shipped, not cancelled; convertBlocker null): made an order as above — the invoice goes, its payments are
 *   advances, the pieces wait in the Workshop.
 * - Shipped or delivered (Shopify fulfilled, or TCS has it), or cancelled/returned: the sale happened (or didn't) and its
 *   invoice is the record of the money, so it STAYS; an order `SHOPIFY-<number>` is made beside it as a finalized order is:
 *   `invoiceId` the invoice, status Completed (every piece done) or Cancelled, no advances (its money is the invoice's, as
 *   any invoiced order's: lib/analytics/cash-in.ts), and the invoice gets `sourceOrderId` so the section lists the order.
 * - Anything else (an exchange, money handed back on an open sale) is left for a person: skipped with the reason.
 */
export async function linkShopifyInvoiceAsOrder(
  db: DbPort,
  inv: InvoiceDoc & { status?: string; amountPaid?: number; balanceDue?: number; shopifyDelivery?: string; shopifyTracking?: { company: string; number: string }; shopifyDeliveryAt?: string; sourceOrderId?: string },
  status: 'Completed' | 'Cancelled',
  deps: Omit<CreateOrderDeps, 'fixedId' | 'extra'>,
): Promise<{ orderId: string } | { skipped: string }> {
  const orderId = orderIdForInvoice(inv);
  const there = await db.get<{ invoiceId?: string }>(ORDERS, orderId);
  if (there && there.invoiceId !== inv.id) return { skipped: 'already an order' };
  if (!there) {
    const byShopifyId = inv.shopifyOrderId ? (await db.queryEquals<{ invoiceId?: string }>(ORDERS, 'shopifyOrderId', String(inv.shopifyOrderId)))[0] : null;
    if (byShopifyId && byShopifyId.invoiceId !== inv.id) return { skipped: 'already an order' };
    const discount = rupees(inv.discountAmount);
    const full = rupees(inv.grandTotal);
    const items = piecesFromInvoice(inv).map(p => ({ ...p, isCompleted: status === 'Completed' }));
    await createOrder(db, {
      items: items as { description?: string }[],
      source: 'shopify',
      customerId: inv.customerId, customerName: inv.customerName, customerContact: inv.customerContact,
      subtotal: full + discount, discountAmount: discount, advancePayment: 0,
      grandTotal: rupees(inv.balanceDue ?? 0),
      notes: [inv.shopifyOrderName ? `Shopify order ${inv.shopifyOrderName}` : '', inv.notes].filter(Boolean).join(' · '),
    }, {
      ...deps,
      fixedId: orderId,
      extra: {
        createdAt: inv.createdAt || new Date().toISOString(),
        status,
        invoiceId: inv.id,
        linkedFromInvoiceId: inv.id,
        ...(inv.shopifyOrderId !== undefined && { shopifyOrderId: String(inv.shopifyOrderId) }),
        ...(Number(inv.shopifyOrderNumber) > 0 && { shopifyOrderNumber: Number(inv.shopifyOrderNumber) }),
        shopifyOrderName: inv.shopifyOrderName || (inv.shopifyOrderNumber ? `#${inv.shopifyOrderNumber}` : undefined),
        shopifyFinancialStatus: String(inv.shopifyFinancialStatus || ''),
        shopifyFulfillment: String(inv.shopifyFulfillment || 'unfulfilled'),
        ...(inv.shopifyCancelledAt && { shopifyCancelledAt: inv.shopifyCancelledAt }),
        ...(inv.shopifyDelivery && { shopifyDelivery: inv.shopifyDelivery }),
        ...(inv.shopifyTracking && { shopifyTracking: inv.shopifyTracking }),
        ...(inv.shopifyDeliveryAt && { shopifyDeliveryAt: inv.shopifyDeliveryAt }),
        ...(inv.whatsappOrder && { whatsappOrder: inv.whatsappOrder }),
        ...(rupees(inv.adjustmentsAmount as number) > 0 && { deliveryCharge: rupees(inv.adjustmentsAmount as number) }),
        advancePayment: 0,
      },
    }, { notify: undefined, log: undefined });
  }
  await db.update(INVOICES, inv.id, { sourceOrderId: orderId });
  return { orderId };
}

/** Shipped out of the shop by Shopify's or TCS's word. */
const shippedOut = (inv: { shopifyFulfillment?: string; shopifyDelivery?: string }) =>
  String(inv.shopifyFulfillment || '').toLowerCase() === 'fulfilled' || isShippedOut(inv.shopifyDelivery);

/** What one old Shopify invoice becomes: an open order (workshop), a Completed or Cancelled order beside it, or left. */
export function conversionFor(inv: ConvertibleInvoice & { shopifyDelivery?: string }): 'open' | 'Completed' | 'Cancelled' | { skip: string } {
  if (inv.sourceOrderId || inv.orderId || inv.fromOrder) return { skip: 'made from an order already' };
  if (inv.status === 'Refunded' || inv.status === 'Cancelled' || inv.shopifyCancelledAt || inv.shopifyDelivery === 'returned') return 'Cancelled';
  if (shippedOut(inv)) return 'Completed';
  // No word from Shopify on shipping (a CSV import from before the ERP): an old sale, done. Its invoice stays.
  if (!String(inv.shopifyFulfillment || '').trim()) return 'Completed';
  const blocker = convertBlocker(inv);
  return blocker ? { skip: blocker } : 'open';
}

export interface ConvertAllResult { seen: number; open: string[]; completed: string[]; cancelled: string[]; skipped: { invoiceId: string; reason: string }[]; remaining: number }

/** One pass over the old Shopify invoices (`source` shopify / shopify_import, not from an order): at most `limit` changed. */
export async function convertAllShopifyInvoices(db: DbPort, deps: ShopifyConvertDeps, limit = 40, fx: SideEffects = {}): Promise<ConvertAllResult> {
  const [api, csv] = await Promise.all([
    db.queryEquals<InvoiceDoc & { status?: string; sourceOrderId?: string; shopifyDelivery?: string }>(INVOICES, 'source', 'shopify'),
    db.queryEquals<InvoiceDoc & { status?: string; sourceOrderId?: string; shopifyDelivery?: string }>(INVOICES, 'source', 'shopify_import'),
  ]);
  const todo = [...api, ...csv].filter(i => !i.sourceOrderId);
  const out: ConvertAllResult = { seen: todo.length, open: [], completed: [], cancelled: [], skipped: [], remaining: 0 };
  const { deleteField: _d, by: _b, ...orderDeps } = deps;
  let done = 0;
  for (const inv of todo) {
    const kind = conversionFor(inv as never);
    if (typeof kind === 'object') { out.skipped.push({ invoiceId: inv.id, reason: kind.skip }); continue; }
    if (done >= limit) { out.remaining++; continue; }
    done++;
    if (kind === 'open') {
      const r = await shopifyInvoicesToOrders(db, [inv.id], deps, fx);
      if (r.converted[0]) out.open.push(r.converted[0].orderId);
      else out.skipped.push({ invoiceId: inv.id, reason: r.skipped[0]?.reason || 'not converted' });
      continue;
    }
    const r = await linkShopifyInvoiceAsOrder(db, inv, kind, orderDeps);
    if ('skipped' in r) { out.skipped.push({ invoiceId: inv.id, reason: r.skipped }); continue; }
    (kind === 'Completed' ? out.completed : out.cancelled).push(r.orderId);
  }
  if (out.open.length + out.completed.length + out.cancelled.length) {
    await Promise.resolve(fx.log?.('order.create', 'Shopify sales made orders', `${out.open.length} to the workshop, ${out.completed.length} completed, ${out.cancelled.length} cancelled`, '')).catch(() => undefined);
  }
  return out;
}
