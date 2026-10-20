/**
 * An advance on an order not yet invoiced: the one copy, run by the browser (owners, the client
 * SDK) and by the iPhone app (/api/app/write, the Admin SDK).
 *
 * Once invoiced, money is taken on the invoice only (the owner, 2026-10-06: "its only from
 * invoice"): an advance on the order would sit there after its advances became the invoice's
 * payments, and the invoice would never see it.
 *
 * No hisaab row: the advance becomes a payment of its own on the invoice when the order is
 * finalised (generateInvoiceFromOrder), and is counted there, once.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { rupees } from '@/lib/money';
import { checkIsoDateIfGiven, checkMoney } from './validate';

const ORDERS = 'orders';

export interface AdvanceInput {
  orderId: string;
  amount: number;
  notes?: string;
  method?: string;
  /** ISO; now when omitted. */
  date?: string;
  /** The app's name for this change: the advance's own id derives from it, so it is listed once. */
  requestId?: string;
}

type OrderDoc = {
  subtotal?: number;
  discountAmount?: number;
  advancePayment?: number;
  advanceInExchangeValue?: number;
  advances?: Record<string, unknown>[];
  invoiceId?: string | null;
} & Record<string, unknown>;

export async function recordOrderAdvance(db: DbPort, input: AdvanceInput, fx: SideEffects = {}) {
  const { orderId, method } = input;
  // Whole rupees: a typed fraction is rounded here, whoever sent it (the web, the apps).
  const amount = rupees(checkMoney(input.amount, 'The advance', { positive: true }));
  const date = checkIsoDateIfGiven(input.date, 'The advance date');
  const notes = input.notes?.trim();
  const advanceId = input.requestId ? `adv-${input.requestId}` : undefined;
  let alreadyIn = false;
  const updated = await db.runTransaction(async tx => {
    alreadyIn = false;
    const order = await tx.get<OrderDoc>(ORDERS, orderId);
    if (!order) throw new Error('Order not found!');
    if (advanceId && (order.advances || []).some(a => a.id === advanceId)) { alreadyIn = true; return { ...order, id: orderId, advancePayment: rupees(order.advancePayment), grandTotal: Number(order.grandTotal) || 0, advances: order.advances || [] }; }
    if (order.invoiceId) throw new Error(`${orderId} is invoiced as ${order.invoiceId} — take the payment on the invoice.`);

    const advancePayment = rupees(order.advancePayment) + amount;
    // The balance as the order form works it out, the discount included.
    const grandTotal = rupees(order.subtotal) - rupees(order.discountAmount) - advancePayment - rupees(order.advanceInExchangeValue);
    // Each advance keeps its day and how it was paid, and becomes a payment of its own on the invoice.
    const advance = { ...(advanceId && { id: advanceId }), amount, date: date || new Date().toISOString(), ...(notes && { notes }), ...(method && { method }) };
    const advances = [...(order.advances || []), advance];
    tx.update(ORDERS, orderId, { advancePayment, grandTotal, advances });
    return { ...order, id: orderId, advancePayment, grandTotal, advances };
  });
  if (alreadyIn) return updated;
  void Promise.resolve(fx.log?.(
    'order.update',
    `Advance recorded for Order ${orderId}`,
    `Amount: ${amount.toLocaleString()}${method ? ` (${method})` : ''}${notes ? ` | ${notes}` : ''}`,
    orderId,
  )).catch(() => undefined);
  return updated;
}
