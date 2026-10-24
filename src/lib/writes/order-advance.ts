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
import { describeExchangeEntry, orderExchangeFields, orderExchanges, type ExchangeEntry } from '@/lib/exchange';
import { orderBalance } from './order-pieces';
import { InputError, checkIsoDateIfGiven, checkMoney } from './validate';

const ORDERS = 'orders';

export interface AdvanceInput {
  orderId: string;
  /** Cash. May be 0 (or left out) when `exchange` is given; one of the two must be above 0. */
  amount?: number;
  /**
   * Gold (or anything) handed over with this advance, at an agreed value: the same row an order or
   * invoice keeps (lib/exchange.ts). Its `value` is what comes off the balance; left out or 0 it is
   * worked out as grams × rate, as the form does.
   */
  exchange?: ExchangeEntry;
  /** More than one row handed over at once (the forms' "Add another exchange"): all join the order in this one write. */
  exchanges?: ExchangeEntry[];
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
  exchanges?: ExchangeEntry[];
  advanceInExchangeDescription?: string;
  invoiceId?: string | null;
} & Record<string, unknown>;

/** The exchange row as the order keeps it: known fields, figures checked, the value worked out from grams × rate when not given. */
export function checkAdvanceExchange(v: unknown): ExchangeEntry {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new InputError('The exchange must be a set of details.');
  const e = v as Record<string, unknown>;
  const given = (k: string, what: string) => (e[k] === undefined || e[k] === null || e[k] === '' ? 0 : checkMoney(e[k], what));
  const weightG = given('weightG', 'The exchange weight');
  const ratePerGram = given('ratePerGram', 'The exchange rate');
  const typed = rupees(given('value', 'The exchange value'));
  const value = typed > 0 ? typed : rupees(Math.round(weightG * ratePerGram));
  if (value <= 0) throw new InputError('The exchange needs a value above 0.');
  const description = typeof e.description === 'string' ? e.description.trim().slice(0, 200) : '';
  const karat = typeof e.karat === 'string' ? e.karat.trim().slice(0, 20) : '';
  return {
    description,
    ...(karat && { karat }),
    ...(weightG > 0 && { weightG }),
    ...(ratePerGram > 0 && { ratePerGram }),
    value,
  };
}

export async function recordOrderAdvance(db: DbPort, input: AdvanceInput, fx: SideEffects = {}) {
  const { orderId, method } = input;
  // Whole rupees: a typed fraction is rounded here, whoever sent it (the web, the apps).
  if (input.exchanges !== undefined && input.exchanges !== null && !Array.isArray(input.exchanges)) throw new InputError('The exchanges must be a list.');
  const exchange = [...(input.exchange ? [input.exchange] : []), ...(input.exchanges || [])].map(checkAdvanceExchange);
  if (exchange.length > 20) throw new InputError('At most 20 exchanges at once.');
  const exchanged = exchange.length > 0;
  const exchangeValue = exchange.reduce((sum, e) => sum + e.value, 0);
  const given = input.amount === undefined || input.amount === null || (exchanged && Number(input.amount) === 0);
  const amount = given ? 0 : rupees(checkMoney(input.amount, 'The advance', { positive: true }));
  if (!exchanged && amount <= 0) throw new InputError('The advance must be above 0.');
  const date = checkIsoDateIfGiven(input.date, 'The advance date');
  const notes = input.notes?.trim();
  // Gold needs an id even without a requestId: its rows are tagged with it, so deleting the advance takes them too.
  const advanceId = input.requestId ? `adv-${input.requestId}` : exchanged ? `adv-${db.newId(ORDERS)}` : undefined;
  let alreadyIn = false;
  const updated = await db.runTransaction(async tx => {
    alreadyIn = false;
    const order = await tx.get<OrderDoc>(ORDERS, orderId);
    if (!order) throw new Error('Order not found!');
    if (advanceId && (order.advances || []).some(a => a.id === advanceId)) { alreadyIn = true; return { ...order, id: orderId, advancePayment: rupees(order.advancePayment), grandTotal: Number(order.grandTotal) || 0, advances: order.advances || [] }; }
    if (order.invoiceId) throw new Error(`${orderId} is invoiced as ${order.invoiceId} — take the payment on the invoice.`);

    const advancePayment = rupees(order.advancePayment) + amount;
    // An exchange joins the order's rows (an older order's single exchange becomes the first row), and the
    // single-exchange totals are kept as the order form keeps them. Without one they are not touched.
    const exchangeFields = exchanged ? orderExchangeFields([...orderExchanges(order, true), ...exchange.map((e) => ({ ...e, advanceId }))]) : undefined;
    const advanceInExchangeValue = exchangeFields ? exchangeFields.advanceInExchangeValue : order.advanceInExchangeValue;
    // The balance as the order form works it out, the discount included.
    const grandTotal = orderBalance({ subtotal: rupees(order.subtotal), discountAmount: rupees(order.discountAmount), advancePayment, advanceInExchangeValue: rupees(advanceInExchangeValue) });
    // Each cash advance keeps its day and how it was paid, and becomes a payment of its own on the invoice.
    // An exchange-only advance is listed too (amount 0, no payment) so a retry finds it; its exchange rides on it.
    const advance = { ...(advanceId && { id: advanceId }), amount, date: date || new Date().toISOString(), ...(notes && { notes }), ...(method && amount > 0 && { method }), ...(exchanged && { exchanges: exchange }) };
    const advances = [...(order.advances || []), advance];
    tx.update(ORDERS, orderId, { advancePayment, grandTotal, advances, ...exchangeFields });
    return { ...order, id: orderId, advancePayment, grandTotal, advances, ...exchangeFields };
  });
  if (alreadyIn) return updated;
  void Promise.resolve(fx.log?.(
    'order.update',
    `Advance recorded for Order ${orderId}`,
    `Amount: ${amount.toLocaleString()}${method && amount > 0 ? ` (${method})` : ''}${exchanged ? ` | Exchange: ${exchange.map(describeExchangeEntry).join('; ')}, ${exchangeValue.toLocaleString()}` : ''}${notes ? ` | ${notes}` : ''}`,
    orderId,
  )).catch(() => undefined);
  return updated;
}
