import type { Order } from '@/lib/store';

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
