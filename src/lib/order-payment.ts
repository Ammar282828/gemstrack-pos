import type { Order, Payment } from '@/lib/store';

export type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid';

/**
 * Whether an order has been paid, from the one number that already knows.
 *
 * `order.grandTotal` is stored NET of both the discount and the advance
 * (order-form: `subtotal - discount - totalAdvance`), so it IS the balance
 * still owed — not a gross total.
 *
 * Both callers used to also test `totalAdvance >= grandTotal`, which compares
 * the advance against a figure the advance has already been taken out of. A
 * 100,000 order with 60,000 down stores a grandTotal of 40,000, and
 * `60,000 >= 40,000` marked it Paid while 40,000 was still outstanding — every
 * order whose advance covered half the price was mislabelled, on the badge and
 * in the list's payment filter. The balance decides it on its own.
 *
 * Lives here because the same function was copy-pasted into the orders list and
 * the order detail page, so fixing one would have left the other wrong.
 */
export function getOrderPaymentStatus(order: Order): PaymentStatus {
  const balance = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
  const advancePayment = typeof order.advancePayment === 'number' ? order.advancePayment : 0;
  const advanceInExchangeValue = typeof order.advanceInExchangeValue === 'number' ? order.advanceInExchangeValue : 0;
  const totalAdvance = advancePayment + advanceInExchangeValue;

  if (balance <= 0) return 'Paid';
  if (totalAdvance > 0) return 'Partial';
  return 'Unpaid';
}

/**
 * An order's cash advances as the invoice's payments, each with its day and how it was paid
 * (the owner, 2026-09-25: "carry over all details from order to invoice, such as advances").
 *
 * `advancePayment` is the running total of every cash advance; `advances` lists the ones
 * recorded after the order was placed. What the list does not account for was taken with the
 * order, on the order's date, by `advanceMethod`. If the total was edited below its list, the
 * total is trusted as one advance. `label` is what each payment's note says ("Advance on order
 * ORD-000123"); the order page shows the same lines.
 */
export function orderAdvancePayments(order: Pick<Order, 'id' | 'createdAt' | 'advancePayment' | 'advanceMethod' | 'advances'>, label = `Advance on order ${order.id}`): Payment[] {
  const cash = Number(order.advancePayment) || 0;
  const later = (order.advances || []).filter((p) => Number(p.amount) > 0);
  const laterSum = later.reduce((sum, p) => sum + Number(p.amount), 0);
  if (laterSum > cash + 0.5) {
    return cash > 0 ? [{ amount: cash, date: order.createdAt, notes: label }] : [];
  }
  const first = cash - laterSum;
  return [
    ...(first > 0.5 ? [{ amount: first, date: order.createdAt, notes: label, ...(order.advanceMethod ? { method: order.advanceMethod } : {}) }] : []),
    ...later.map((p) => ({ ...p, amount: Number(p.amount), notes: p.notes?.trim() ? `${label}: ${p.notes.trim()}` : label })),
  ];
}
