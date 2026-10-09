/**
 * What an invoice's own actions do to its figures, worked out before anything is written: changing the
 * discount, a partial refund, deleting one payment, and which pieces a delete puts back in stock
 * (components/invoice/invoice-viewer.tsx; the store's updateInvoiceDiscount, refundInvoicePartial,
 * deleteInvoicePayment and deleteInvoice).
 *
 * One copy, so what a screen says will happen is what the write then does: the shared writes
 * (lib/writes/invoice-discount.ts, invoice-refund.ts) take their figures from here,
 * and the iPhone app's confirmations from the same rules ported line for line (ERPCore InvoiceActions,
 * with these tests). A missing figure on an old document counts as nothing, as the Swift models read it.
 */

type PaymentLike = { amount?: number | null };
type ItemLike = { sku?: string | null };

export interface InvoiceFigures {
  subtotal?: number | null;
  exchangeAmount1?: number | null;
  exchangeAmount2?: number | null;
  grandTotal?: number | null;
  amountPaid?: number | null;
  paymentHistory?: PaymentLike[] | null;
}

const num = (v: unknown) => Number(v) || 0;

/** The invoice page's refusals, in its words; null when the discount can be saved. */
export function discountProblem(subtotal: number | null | undefined, discount: number): string | null {
  if (!Number.isFinite(discount)) return 'Enter the discount.';
  if (discount < 0) return 'Discount cannot be negative.';
  if (discount > num(subtotal)) return 'Discount cannot exceed subtotal.';
  return null;
}

/**
 * The invoice with a new discount: the lines less the discount and the exchange (the two totals every
 * invoice keeps, lib/exchange.ts invoiceExchangeFields), and what is still owed on what has been paid.
 * Adjustments are left out, as every sale's total leaves them out (writes/create-invoice.ts).
 */
export function withDiscount(inv: InvoiceFigures, discount: number) {
  const grandTotal = num(inv.subtotal) - discount - num(inv.exchangeAmount1) - num(inv.exchangeAmount2);
  return { discountAmount: discount, grandTotal, balanceDue: grandTotal - num(inv.amountPaid) };
}

/** The refund's line in the payment history: what was handed back, as money out. */
export function refundEntry(amount: number, date: string, reason?: string) {
  return { amount: -Math.abs(amount), date, notes: reason ? `Refund: ${reason}` : 'Refund' };
}

/**
 * A partial refund: a negative payment on the history, and what is paid and owed recomputed from the
 * whole history, so a refund recorded twice is seen in the figures and never hidden by a running total.
 */
export function withRefund(inv: InvoiceFigures, amount: number, date: string, reason?: string) {
  const paymentHistory = [...(inv.paymentHistory || []), refundEntry(amount, date, reason)];
  const amountPaid = paymentHistory.reduce((s, p) => s + num(p.amount), 0);
  return { paymentHistory, amountPaid, balanceDue: num(inv.grandTotal) - amountPaid };
}

/** One payment off the history (its place as the page shows it), and what is paid and owed without it; null when there is none there. */
export function withoutPayment(inv: InvoiceFigures, index: number) {
  const history = inv.paymentHistory || [];
  if (!Number.isInteger(index) || index < 0 || index >= history.length) return null;
  const paymentHistory = history.filter((_, i) => i !== index);
  const amountPaid = paymentHistory.reduce((s, p) => s + num(p.amount), 0);
  return { paymentHistory, amountPaid, balanceDue: num(inv.grandTotal) - amountPaid };
}

/** An invoice's lines, whether stored as a list or as the map keyed "0", "1" some older ones are. */
export function invoiceLines<T extends ItemLike>(items: T[] | Record<string, T> | null | undefined): T[] {
  const all = Array.isArray(items) ? items : items && typeof items === 'object' ? Object.values(items) : [];
  return all.filter((l): l is T => !!l && typeof l === 'object');
}

/**
 * The pieces a deleted invoice puts back in stock, each once (lib/writes/delete-invoice.ts writes them).
 * A piece made for an order (ORD-…) was never in stock; a piece another invoice also sold (a sale entered
 * twice) stays sold, to that invoice.
 */
export function piecesBackInStock<T extends ItemLike>(
  invoice: { id: string; items?: T[] | Record<string, T> | null },
  others: { id: string; items?: ItemLike[] | Record<string, ItemLike> | null }[],
): T[] {
  const elsewhere = new Set<string>();
  for (const o of others) {
    if (o.id === invoice.id) continue;
    for (const line of invoiceLines(o.items)) if (typeof line.sku === 'string' && line.sku) elsewhere.add(line.sku);
  }
  const seen = new Set<string>();
  return invoiceLines(invoice.items).filter(i => {
    const sku = i.sku;
    if (typeof sku !== 'string' || !sku || sku.startsWith('ORD-') || elsewhere.has(sku) || seen.has(sku)) return false;
    seen.add(sku);
    return true;
  });
}
