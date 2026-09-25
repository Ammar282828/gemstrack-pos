/**
 * Cash in over a period: the money that actually came into the shop, each rupee once, on the
 * day it came.
 *
 * - Payments on invoices, whatever day the invoice was written.
 * - Cash advances on orders that are not an invoice yet (orderAdvancePayments: the one taken
 *   with the order on its date, each later one on its own). Finalising an order copies its
 *   advances onto the invoice as payments with the same days, so from then on they are counted
 *   there and not here, and a period's cash does not move when an order is finalised. An order
 *   counts as invoiced when it names its invoice or an invoice names it (older data has only
 *   the invoice's `sourceOrderId`).
 * - Extra revenue.
 *
 * Gold taken in exchange is not cash. It is reported on its own (`exchange`) on the day it was
 * taken: an invoice's exchange on the invoice's revenue date, an open order's on the order's.
 *
 * Invoices made from an order before 2026-09-25 carry the order's advance as ONE payment whose
 * amount is the cash and the exchange together, noted "Advance from Order. Cash: X. Exchange: Y
 * (…)". Only X's share of it is cash. The share is taken from the note rather than subtracting
 * Y, because a bill with a coin on it reaches here already split pro rata (analytics/coins.ts),
 * which scales the amount but not the note.
 */

import { parseISO } from 'date-fns';
import type { AdditionalRevenue, Invoice, Order, Payment } from '@/lib/store';
import { orderAdvancePayments } from '@/lib/order-payment';
import { exchangeTotal, invoiceExchanges, orderExchanges } from '@/lib/exchange';

/** Either end left null is open. */
export interface Period { from: Date | null; to: Date | null }

export interface CashIn {
  invoicePayments: number;
  /** Cash advances on orders not invoiced yet. */
  orderAdvances: number;
  extraRevenue: number;
  /** invoicePayments + orderAdvances + extraRevenue. */
  total: number;
  /** Gold (or anything) taken in exchange, at the value agreed. Not in `total`. */
  exchange: number;
  /** The part of `exchange` that revenue counts in full: an open order's (its revenue is its
   *  whole subtotal) and an older invoice's, inside its advance payment. An invoice's own
   *  exchange is already off its grand total. Revenue less cash less this is what is still owed. */
  exchangeCountedInRevenue: number;
}

type CashInvoice = Pick<Invoice, 'status' | 'createdAt' | 'paymentHistory' | 'exchanges' | 'exchangeDescription' | 'exchangeAmount1' | 'exchangeAmount2'>;
type CashOrder = Pick<Order, 'id' | 'status' | 'createdAt' | 'advancePayment' | 'advanceMethod' | 'advances' | 'exchanges' | 'advanceInExchangeDescription' | 'advanceInExchangeValue'>;

const inPeriod = (iso: string | undefined, { from, to }: Period) => {
  if (!iso) return false;
  if (!from && !to) return true;
  // parseISO, as the rest of the page: a bare "2026-09-01" is local midnight, not UTC.
  const t = parseISO(iso).getTime();
  if (Number.isNaN(t)) return false;
  return (!from || t >= from.getTime()) && (!to || t <= to.getTime());
};

const LEGACY_ORDER_ADVANCE = /^Advance from Order\. Cash: (\S*)\. Exchange: (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i;

/** How much of a payment was gold taken in exchange rather than cash: only an older order
 *  advance ever held any. */
export function paymentExchangePart(p: Pick<Payment, 'amount' | 'notes'>): number {
  const amount = Number(p.amount) || 0;
  const m = amount > 0 && p.notes ? LEGACY_ORDER_ADVANCE.exec(p.notes) : null;
  if (!m) return 0;
  const cash = Math.max(0, Number(m[1]) || 0);
  const exchange = Math.max(0, Number(m[2]) || 0);
  if (exchange <= 0) return 0;
  return Math.round((amount * exchange / (cash + exchange)) * 100) / 100;
}

/** Orders already made into an invoice: their advances are that invoice's payments now. */
export function invoicedOrderIds(
  orders: Pick<Order, 'id' | 'invoiceId'>[],
  invoices: Pick<Invoice, 'sourceOrderId'>[],
): Set<string> {
  const ids = new Set<string>();
  for (const o of orders) if (o?.invoiceId) ids.add(o.id);
  for (const inv of invoices) if (inv?.sourceOrderId) ids.add(inv.sourceOrderId);
  return ids;
}

export function cashInForPeriod<I extends CashInvoice>({
  invoices, orders, invoiced, extraRevenues, period, invoiceDate = (inv) => inv.createdAt,
}: {
  /** The invoices whose payments count. */
  invoices: I[];
  orders: CashOrder[];
  /** From invoicedOrderIds, over every invoice (the coin ones too). */
  invoiced: Set<string>;
  extraRevenues: Pick<AdditionalRevenue, 'date' | 'amount'>[];
  period: Period;
  /** The day an invoice's exchange was taken; analytics passes its revenue date. */
  invoiceDate?: (inv: I) => string;
}): CashIn {
  let invoicePayments = 0;
  let invoiceExchange = 0;
  let legacyExchange = 0;
  for (const inv of invoices) {
    if (!inv || inv.status === 'Refunded') continue;
    for (const p of Array.isArray(inv.paymentHistory) ? inv.paymentHistory : []) {
      if (!p || !inPeriod(p.date, period)) continue;
      const inKind = paymentExchangePart(p);
      invoicePayments += (Number(p.amount) || 0) - inKind;
      legacyExchange += inKind;
    }
    if (inPeriod(invoiceDate(inv), period)) invoiceExchange += exchangeTotal(invoiceExchanges(inv));
  }

  let orderAdvances = 0;
  let orderExchange = 0;
  for (const o of orders) {
    if (!o || o.status === 'Cancelled' || o.status === 'Refunded' || invoiced.has(o.id)) continue;
    for (const p of orderAdvancePayments(o)) if (inPeriod(p.date, period)) orderAdvances += p.amount;
    if (inPeriod(o.createdAt, period)) orderExchange += exchangeTotal(orderExchanges(o));
  }

  const extraRevenue = extraRevenues.reduce((s, r) => s + (r && inPeriod(r.date, period) ? Number(r.amount) || 0 : 0), 0);

  return {
    invoicePayments,
    orderAdvances,
    extraRevenue,
    total: invoicePayments + orderAdvances + extraRevenue,
    exchange: invoiceExchange + legacyExchange + orderExchange,
    exchangeCountedInRevenue: legacyExchange + orderExchange,
  };
}
