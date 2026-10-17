/**
 * "Settle — give the remaining PKR X off" (decision "Round-off"), done in one write.
 *
 * Giving a discount is the owner's (the invoice's Discount, the order form), so every op here is
 * owner-only on /api/app/write and the web shows Settle to owners only (use-can-discount.ts). Each is ONE
 * transaction, so a settle can never half-apply (a payment taken and the discount refused, leaving the
 * balance at X):
 *
 * - settleInvoicePayment: the payment and the raised discount on an invoice, with its ledger row and
 *   its order's balance following in the same commit.
 * - settleOrderAdvance:   the advance and the raised discount on an open order.
 * - raiseOrderDiscount:   only the discount of an open order, for a settle with no payment beside it.
 *   Unlike updateOrder it recomputes nothing but the discount, the balance and updatedAt: the stage is
 *   not touched (updateOrder runs statusFromPieces).
 *
 * `extra` is the amount ADDED to the discount already on file, in whole rupees (lib/money-round.ts).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { discountProblem, withDiscount } from '@/lib/invoice-actions';
import { rupees } from '@/lib/money-round';
import { followBalance, type PaidInvoice } from '@/lib/writes/invoice-payment';

const INVOICES = 'invoices';
const HISAAB = 'hisaab';
const ORDERS = 'orders';

/** A refusal in the page's words (the route answers 400/409, not a crash). */
export class SettleRefusal extends Error {}

/** The extra, as whole rupees above zero; anything else is refused. */
function extraOf(v: unknown): number {
  const n = rupees(v);
  if (!Number.isFinite(Number(v)) || n <= 0) throw new SettleRefusal('Enter the amount to take off.');
  return n;
}

type LinkedRow = { id: string; cashDebit?: number; cashCredit?: number; description?: string };
type InvoiceDoc = Omit<PaidInvoice, 'id'> & { subtotal?: number; discountAmount?: number; exchangeAmount1?: number; exchangeAmount2?: number };

export interface SettleInvoiceInput {
  invoiceId: string;
  amount: number;
  date: string;
  method?: string;
  reference?: string;
  extra: number;
}

/** A payment and the discount raised by `extra`, in one commit. Returns the invoice as it now stands. */
export async function settleInvoicePayment(db: DbPort, input: SettleInvoiceInput, fx: SideEffects = {}) {
  const { invoiceId, date, method, reference } = input;
  const amount = rupees(input.amount);
  const extra = extraOf(input.extra);
  if (!(amount > 0)) throw new SettleRefusal('A positive amount is required.');
  const linkedRows = db.queryEquals<LinkedRow>(HISAAB, 'linkedInvoiceId', invoiceId);
  linkedRows.catch(() => { /* surfaced by the await inside the transaction */ });

  const updated = await db.runTransaction(async tx => {
    const [invoice, linked] = await Promise.all([tx.get<InvoiceDoc>(INVOICES, invoiceId), linkedRows]);
    if (!invoice) throw new SettleRefusal('Invoice not found!');
    const payment = {
      amount, date,
      notes: method ? `Payment received (${method})` : 'Payment received',
      ...(method && { method }),
      ...(reference?.trim() && { reference: reference.trim() }),
    };
    const paymentHistory = [...(invoice.paymentHistory || []), payment];
    const amountPaid = rupees(paymentHistory.reduce((acc, p) => acc + p.amount, 0));
    const discount = rupees(invoice.discountAmount) + extra;
    const problem = discountProblem(invoice.subtotal, discount);
    if (problem) throw new SettleRefusal(problem);
    const fields = withDiscount({ ...invoice, amountPaid } as never, discount);
    tx.update(INVOICES, invoiceId, { paymentHistory, amountPaid, ...fields });
    followBalance(db, tx, invoiceId, invoice, linked, fields.balanceDue, false);
    return { ...invoice, paymentHistory, amountPaid, ...fields, id: invoiceId };
  });

  void Promise.resolve(fx.log?.(
    'invoice.payment',
    `Payment received for invoice ${invoiceId}`,
    `Amount: ${amount.toLocaleString()} | Settled: ${extra.toLocaleString()} off | Customer: ${updated.customerName}`,
    invoiceId,
  )).catch(() => { /* logged by the driver */ });
  fx.syncInvoiceShopify?.(invoiceId, 'upsert');
  fx.notify?.(invoiceId);
  return updated;
}

type OrderDoc = {
  subtotal?: number; discountAmount?: number; advancePayment?: number; advanceInExchangeValue?: number;
  advances?: Record<string, unknown>[]; invoiceId?: string | null;
} & Record<string, unknown>;

/** The order's balance as the order form works it out, the discount included. */
const balanceOf = (o: OrderDoc, discount: number, advancePayment: number) =>
  rupees(o.subtotal) - discount - advancePayment - rupees(o.advanceInExchangeValue);

function openOrder(order: OrderDoc | null, orderId: string): OrderDoc {
  if (!order) throw new SettleRefusal('Order not found!');
  if (order.invoiceId) throw new SettleRefusal(`${orderId} is invoiced as ${order.invoiceId} — settle on the invoice.`);
  return order;
}

function raisedDiscount(order: OrderDoc, extra: number): number {
  const discount = rupees(order.discountAmount) + extra;
  const problem = discountProblem(order.subtotal, discount);
  if (problem) throw new SettleRefusal(problem);
  return discount;
}

/** Only the discount (and the balance that follows from it) of an order not yet invoiced. */
export async function raiseOrderDiscount(db: DbPort, input: { orderId: string; extra: number }, fx: SideEffects = {}) {
  const { orderId } = input;
  const extra = extraOf(input.extra);
  const updated = await db.runTransaction(async tx => {
    const order = openOrder(await tx.get<OrderDoc>(ORDERS, orderId), orderId);
    const discountAmount = raisedDiscount(order, extra);
    const grandTotal = balanceOf(order, discountAmount, rupees(order.advancePayment));
    const fields = { discountAmount, grandTotal, updatedAt: new Date().toISOString() };
    tx.update(ORDERS, orderId, fields);
    return { ...order, id: orderId, ...fields };
  });
  void Promise.resolve(fx.log?.('order.update', `Discount raised on Order ${orderId}`, `Taken off: ${extra.toLocaleString()}`, orderId)).catch(() => undefined);
  return updated;
}

/** An advance and the raised discount on an open order, in one commit. */
export async function settleOrderAdvance(
  db: DbPort,
  input: { orderId: string; amount: number; extra: number; notes?: string; method?: string; date?: string },
  fx: SideEffects = {},
) {
  const { orderId, method } = input;
  const amount = rupees(input.amount);
  const extra = extraOf(input.extra);
  if (!(amount > 0)) throw new SettleRefusal('A positive amount is required.');
  const notes = input.notes?.trim();
  const updated = await db.runTransaction(async tx => {
    const order = openOrder(await tx.get<OrderDoc>(ORDERS, orderId), orderId);
    const discountAmount = raisedDiscount(order, extra);
    const advancePayment = rupees(order.advancePayment) + amount;
    const grandTotal = balanceOf(order, discountAmount, advancePayment);
    const advance = { amount, date: input.date || new Date().toISOString(), ...(notes && { notes }), ...(method && { method }) };
    const advances = [...(order.advances || []), advance];
    const fields = { advancePayment, discountAmount, grandTotal, advances };
    tx.update(ORDERS, orderId, fields);
    return { ...order, id: orderId, ...fields };
  });
  void Promise.resolve(fx.log?.(
    'order.update',
    `Advance recorded for Order ${orderId}`,
    `Amount: ${amount.toLocaleString()}${method ? ` (${method})` : ''} | Settled: ${extra.toLocaleString()} off${notes ? ` | ${notes}` : ''}`,
    orderId,
  )).catch(() => undefined);
  return updated;
}
