/**
 * Today's cash: what came in today by how it was paid, what went out, and what the drawer should
 * have gained (the audit of 2026-10-01: Home → Today's cash, and the 9 pm report's "Net cash",
 * which counted invoice payments only and added card and bank to cash).
 *
 * Built on cash-in.ts, the rule Analytics' Cash In uses, so the two never disagree on a day:
 *   in   invoice payments (by their own method), cash advances on orders not yet invoiced, repair
 *        payments (by the repair's own record of the method), other Extra revenue (no method is
 *        recorded for those: "Not recorded")
 *   out  expenses paid by the business today — expenses carry no method, so every one the business
 *        paid (not a partner out of pocket) is counted as leaving the drawer
 *   exchange  gold (or anything) taken in exchange today, at the value agreed: its own line, never
 *        in cash — it is in the safe, not the drawer
 * Net cash is the drawer: money in by Cash, less the business's expenses.
 * "Today" is Karachi's day, not the server's (the report runs in UTC).
 */

import type { AdditionalRevenue, Expense, Invoice, Order, PaymentType, Repair } from '@/lib/store';
import { cashInForPeriod, invoicedOrderIds, paymentExchangePart, type Period } from '@/lib/analytics/cash-in';
import { orderAdvancePayments } from '@/lib/order-payment';

export const METHODS = ['Cash', 'Card', 'Bank Transfer', 'Cheque', 'Not recorded'] as const;
export type Method = typeof METHODS[number];

export interface CashLine {
  source: 'invoice' | 'advance' | 'repair' | 'extra';
  /** INV-…, ORD-…, REP-…, or the Extra revenue row's words. */
  ref: string;
  who: string;
  amount: number;
  method: Method;
  at: string;
}

export interface TodaysCash {
  /** Karachi's date, yyyy-mm-dd. */
  day: string;
  /** Money in by method (exchange never here). */
  byMethod: Record<Method, number>;
  /** Money in, every method. */
  totalIn: number;
  exchange: number;
  /** What the business paid out today. */
  expenses: number;
  expenseLines: { description: string; amount: number; category: string }[];
  /** The drawer: Cash in less expenses. */
  netCash: number;
  lines: CashLine[];
}

const KARACHI_MS = 5 * 3_600_000; // UTC+5, no daylight saving

/** Karachi's day around `now`: its date and [start, end] as instants. */
export function karachiDayPeriod(now: Date): { day: string; period: Period } {
  const local = new Date(now.getTime() + KARACHI_MS);
  const day = local.toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00.000Z`).getTime() - KARACHI_MS;
  return { day, period: { from: new Date(start), to: new Date(start + 86_400_000 - 1) } };
}

const within = (iso: string | undefined, { from, to }: Period) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && (!from || t >= from.getTime()) && (!to || t <= to.getTime());
};
const methodOf = (m: PaymentType | string | null | undefined): Method =>
  (METHODS as readonly string[]).includes(m as string) && m !== 'Not recorded' ? m as Method : 'Not recorded';

export function todaysCash(input: {
  invoices: Invoice[];
  orders: Order[];
  repairs: Repair[];
  extraRevenues: AdditionalRevenue[];
  expenses: Expense[];
  now?: Date;
}): TodaysCash {
  const { day, period } = karachiDayPeriod(input.now ?? new Date());
  const lines: CashLine[] = [];

  for (const inv of input.invoices) {
    if (!inv || inv.status === 'Refunded') continue;
    for (const p of Array.isArray(inv.paymentHistory) ? inv.paymentHistory : []) {
      if (!p || !within(p.date, period)) continue;
      const amount = (Number(p.amount) || 0) - paymentExchangePart(p);
      if (amount) lines.push({ source: 'invoice', ref: inv.id, who: inv.customerName || 'Walk-in', amount, method: methodOf(p.method), at: p.date });
    }
  }
  const invoiced = invoicedOrderIds(input.orders, input.invoices);
  for (const o of input.orders) {
    if (!o || o.status === 'Cancelled' || o.status === 'Refunded' || invoiced.has(o.id)) continue;
    for (const p of orderAdvancePayments(o)) {
      if (within(p.date, period) && p.amount) lines.push({ source: 'advance', ref: o.id, who: o.customerName || 'Walk-in', amount: p.amount, method: methodOf(p.method), at: p.date });
    }
  }
  // A repair's money is written to Extra revenue with its repairId; the method is on the repair.
  const repairPayment = new Map<string, { repair: Repair; method?: PaymentType }>();
  for (const r of input.repairs) for (const p of r?.payments ?? []) if (p.revenueId) repairPayment.set(p.revenueId, { repair: r, method: p.method });
  for (const r of input.extraRevenues) {
    if (!r || !within(r.date, period) || !Number(r.amount)) continue;
    const rep = r.repairId ? repairPayment.get(r.id) : undefined;
    lines.push(r.repairId
      ? { source: 'repair', ref: r.repairId, who: rep?.repair.customerName || r.description, amount: Number(r.amount), method: methodOf(rep?.method), at: r.date }
      : { source: 'extra', ref: r.description, who: '', amount: Number(r.amount), method: 'Not recorded', at: r.date });
  }

  // The totals by cash-in.ts's own rule, so the page and Analytics agree to the rupee.
  const cashIn = cashInForPeriod({ invoices: input.invoices, orders: input.orders, invoiced, extraRevenues: input.extraRevenues, period });
  const byMethod = Object.fromEntries(METHODS.map(m => [m, 0])) as Record<Method, number>;
  for (const l of lines) byMethod[l.method] += l.amount;
  const totalIn = lines.reduce((s, l) => s + l.amount, 0);
  if (Math.abs(totalIn - (cashIn.invoicePayments + cashIn.orderAdvances + cashIn.extraRevenue)) > 1) {
    // Never expected: both walk the same records. Say so rather than show two truths.
    console.warn('[todaysCash] lines and cash-in.ts disagree', totalIn, cashIn);
  }

  const paidOut = input.expenses.filter(e => e && within(e.date, period) && (!e.paidBy || e.paidBy === 'business'));
  const expenses = paidOut.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  return {
    day,
    byMethod,
    totalIn,
    exchange: cashIn.exchange,
    expenses,
    expenseLines: paidOut.map(e => ({ description: e.description, amount: Number(e.amount) || 0, category: String(e.category ?? '') })),
    netCash: byMethod.Cash - expenses,
    lines: lines.sort((a, b) => a.at.localeCompare(b.at)),
  };
}
