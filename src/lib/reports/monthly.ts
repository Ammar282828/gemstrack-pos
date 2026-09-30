/**
 * A month of the shop, for the monthly report PDF (monthly-pdf.ts): every sale listed, and
 * the month's figures on the same rules as Analytics, so the two always agree.
 *
 * Analytics' rules, followed here exactly:
 * - Revenue is jewellery invoices at their sale value (exchange counted —
 *   analytics/sale-value.ts), an invoice made from an order on the order's date; orders not
 *   yet invoiced at their full subtotal, on the day they were taken; and other income (repairs
 *   and the like, `additional_revenue`). Refunded invoices and cancelled orders count nothing.
 * - Gold coins are not jewellery (analytics/coins.ts): their sales are a line of their own.
 * - Cash in is analytics/cash-in.ts: payments by their date, order advances until the order is
 *   invoiced, exchange taken, other income.
 * - Expenses are business costs (partnership.ts); a partner's drawings are shown, not counted.
 *
 * Months are Karachi's (UTC+5), whatever the machine's clock says.
 * Pure: the route and the WhatsApp report read Firestore and hand everything in.
 */

import type { AdditionalRevenue, Expense, Invoice, Order, Payment } from '@/lib/store';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { splitAllCoinSales } from '@/lib/analytics/coins';
import { cashInForPeriod, invoicedOrderIds, type CashIn } from '@/lib/analytics/cash-in';
import { exchangeTotal, invoiceExchanges } from '@/lib/exchange';
import { orderAdvancePayments } from '@/lib/order-payment';
import { isBusinessCost } from '@/lib/partnership';

export interface MonthRef { year: number; month: number }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

export const monthKey = (m: MonthRef) => `${m.year}-${pad(m.month)}`;
export const monthLabel = (m: MonthRef) => `${MONTHS[m.month - 1]} ${m.year}`;

/** "2026-09" → { 2026, 9 }; anything else → null. */
export function parseMonth(s: unknown): MonthRef | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]);
  return month >= 1 && month <= 12 && year >= 2000 && year <= 2100 ? { year, month } : null;
}

export const addMonths = (m: MonthRef, n: number): MonthRef => {
  const i = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};

/** The month a moment falls in, in Karachi. */
export function karachiMonth(d: Date): MonthRef {
  const k = new Date(d.getTime() + 5 * 3600_000);
  return { year: k.getUTCFullYear(), month: k.getUTCMonth() + 1 };
}

/** First and last instant of a Karachi month. */
export function monthBounds(m: MonthRef): { from: Date; to: Date } {
  const from = new Date(`${m.year}-${pad(m.month)}-01T00:00:00+05:00`);
  const next = addMonths(m, 1);
  const to = new Date(new Date(`${next.year}-${pad(next.month)}-01T00:00:00+05:00`).getTime() - 1);
  return { from, to };
}

/** A stored date as an instant. A bare "2026-09-01" is that day in Karachi, as the counter meant it. */
function instant(iso: string | undefined | null): number {
  if (!iso) return NaN;
  const s = String(iso);
  return (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00+05:00`) : new Date(s)).getTime();
}
/** The Karachi day of a stored date, "2026-09-30" ('' when it isn't one). */
function karachiDay(iso: string | undefined | null): string {
  const t = instant(iso);
  return Number.isNaN(t) ? '' : new Date(t + 5 * 3600_000).toISOString().slice(0, 10);
}
const within = (iso: string | undefined | null, b: { from: Date; to: Date }) => {
  const t = instant(iso);
  return t >= b.from.getTime() && t <= b.to.getTime();
};

/** store.ts' getInvoiceRevenueDate, here so the server never imports the client store. */
export function revenueDate(inv: Pick<Invoice, 'createdAt' | 'sourceOrderId'>, ordersById: Map<string, Pick<Order, 'createdAt'>>): string {
  const order = inv.sourceOrderId ? ordersById.get(inv.sourceOrderId) : undefined;
  return order?.createdAt || inv.createdAt;
}

const itemsOf = (inv: Invoice) => (Array.isArray(inv.items) ? inv.items : Object.values((inv.items || {}) as Record<string, Invoice['items'][number]>));
const n = (v: unknown) => Number(v) || 0;

export interface SaleRow {
  id: string;
  /** The day it counts on (the order's, for an invoice made from one). */
  date: string;
  /** The day the invoice was written, when that is another day. */
  invoicedOn?: string;
  orderId?: string;
  customer: string;
  pieces: string[];
  value: number;
  discount: number;
  exchange: number;
  paid: number;
  balance: number;
  coin: boolean;
  refunded: boolean;
}
export interface OpenOrderRow { id: string; date: string; customer: string; summary: string; value: number; advance: number }
export interface PaymentRow { date: string; ref: string; customer: string; method: string; amount: number }
export interface IncomeRow { date: string; description: string; amount: number }
export interface ExpenseRow { date: string; category: string; description: string; amount: number; business: boolean }

export interface MonthFigures {
  /** Analytics' revenue for the month: jewellery sales + open orders taken + other income. */
  revenue: number;
  cashIn: number;
  expenses: number;
}

export interface MonthlyReport {
  month: MonthRef;
  label: string;
  from: string;
  to: string;
  /** The month is not over yet. */
  partial: boolean;
  generatedAt: string;
  revenue: { invoices: number; openOrders: number; other: number; total: number; coins: number };
  counts: { invoices: number; pieces: number; openOrders: number; customers: number; refunded: number };
  /** Metal sold on jewellery invoices, by metal and karat, heaviest first. */
  metal: { label: string; grams: number }[];
  cashIn: CashIn;
  /** Payments and advances by how they were paid (exchange and other income are not payments). */
  byMethod: { method: string; amount: number }[];
  expenses: { business: number; drawings: number; byCategory: { category: string; amount: number }[] };
  /** Revenue less business expenses — before the metal and the karigars' work, so not profit. */
  net: number;
  owed: { onThisMonth: number; allOpen: number };
  previous: MonthFigures & { label: string };
  sales: SaleRow[];
  openOrders: OpenOrderRow[];
  payments: PaymentRow[];
  income: IncomeRow[];
  expenseRows: ExpenseRow[];
}

export interface MonthlyInput {
  invoices: Invoice[];
  orders: Order[];
  expenses: Expense[];
  extraRevenues: AdditionalRevenue[];
}

function metalLabel(item: Invoice['items'][number]): string {
  const metal = String(item.metalType || '').trim();
  const karat = String(item.karat || '').trim().toUpperCase();
  const name = metal ? metal[0].toUpperCase() + metal.slice(1) : 'Metal';
  return karat ? `${name} ${karat}` : name;
}

function pieceLine(item: Invoice['items'][number]): string {
  const bits = [String(item.name || item.sku || 'Piece').trim()];
  const karat = String(item.karat || '').trim();
  if (karat) bits.push(karat.toUpperCase());
  if (n(item.metalWeightG) > 0) bits.push(`${n(item.metalWeightG).toFixed(2)} g`);
  const qty = n(item.quantity);
  return `${qty > 1 ? `${qty} × ` : ''}${bits.join(' · ')}`;
}

/** Revenue, cash in and expenses alone, for the month-before comparison. */
function figures(input: MonthlyInput, b: { from: Date; to: Date }, ordersById: Map<string, Order>): MonthFigures {
  const { jewellery } = splitAllCoinSales(input.invoices);
  let revenue = 0;
  for (const inv of jewellery) if (inv?.createdAt && inv.status !== 'Refunded' && within(revenueDate(inv, ordersById), b)) revenue += invoiceSaleValue(inv);
  for (const o of input.orders) if (o?.createdAt && o.status !== 'Cancelled' && o.status !== 'Refunded' && !o.invoiceId && within(o.createdAt, b)) revenue += n(o.subtotal);
  for (const r of input.extraRevenues) if (r?.date && within(r.date, b)) revenue += n(r.amount);
  const cash = cashInForPeriod({
    invoices: jewellery, orders: input.orders, invoiced: invoicedOrderIds(input.orders, input.invoices),
    extraRevenues: input.extraRevenues, period: b, invoiceDate: inv => revenueDate(inv, ordersById),
  });
  const expenses = input.expenses.reduce((s, e) => s + (e?.date && within(e.date, b) && isBusinessCost(e) ? n(e.amount) : 0), 0);
  return { revenue, cashIn: cash.total, expenses };
}

export function buildMonthlyReport(input: MonthlyInput, month: MonthRef, now = new Date()): MonthlyReport {
  const b = monthBounds(month);
  const ordersById = new Map(input.orders.map(o => [o.id, o]));
  const { jewellery, coins } = splitAllCoinSales(input.invoices);
  const coinIds = new Set(coins.map(c => c.id));
  const jewelleryIds = new Set(jewellery.map(j => j.id));

  // ── Every invoice of the month, whole (a bill with a coin and a ring is one sale on paper).
  const inMonth = input.invoices.filter(inv => inv?.createdAt && within(revenueDate(inv, ordersById), b));
  const sales: SaleRow[] = inMonth.map(inv => {
    const date = revenueDate(inv, ordersById);
    const sameDay = karachiDay(date) === karachiDay(inv.createdAt);
    return {
      id: inv.id,
      date,
      ...(!sameDay ? { invoicedOn: inv.createdAt } : {}),
      ...(inv.sourceOrderId ? { orderId: inv.sourceOrderId } : {}),
      customer: (inv.customerName || 'Walk-in Customer').trim(),
      pieces: itemsOf(inv).map(pieceLine),
      value: invoiceSaleValue(inv),
      discount: n(inv.discountAmount),
      exchange: exchangeTotal(invoiceExchanges(inv)),
      paid: n(inv.amountPaid),
      balance: Math.max(0, n(inv.balanceDue)),
      coin: coinIds.has(inv.id) && !jewelleryIds.has(inv.id),
      refunded: inv.status === 'Refunded',
    };
  }).sort((x, y) => instant(x.date) - instant(y.date) || x.id.localeCompare(y.id));

  // ── Revenue, exactly as Analytics adds it up.
  let invoiceRevenue = 0, coinRevenue = 0, pieces = 0;
  const metal = new Map<string, number>();
  for (const inv of jewellery) {
    if (!inv?.createdAt || inv.status === 'Refunded' || !within(revenueDate(inv, ordersById), b)) continue;
    invoiceRevenue += invoiceSaleValue(inv);
    for (const item of itemsOf(inv)) {
      pieces += Math.max(1, n(item.quantity));
      const g = n(item.metalWeightG) * Math.max(1, n(item.quantity));
      if (g > 0) metal.set(metalLabel(item), (metal.get(metalLabel(item)) ?? 0) + g);
    }
  }
  for (const inv of coins) if (inv?.createdAt && inv.status !== 'Refunded' && within(revenueDate(inv, ordersById), b)) coinRevenue += invoiceSaleValue(inv);

  const openOrders: OpenOrderRow[] = input.orders
    .filter(o => o?.createdAt && o.status !== 'Cancelled' && o.status !== 'Refunded' && !o.invoiceId && within(o.createdAt, b))
    .map(o => ({
      id: o.id,
      date: o.createdAt,
      customer: (o.customerName || 'Walk-in Customer').trim(),
      summary: (o.summary || (o.items || []).map(i => i.description).filter(Boolean).join(', ') || '').trim(),
      value: n(o.subtotal),
      advance: n(o.advancePayment),
    }))
    .sort((x, y) => instant(x.date) - instant(y.date));
  const openRevenue = openOrders.reduce((s, o) => s + o.value, 0);

  const income: IncomeRow[] = input.extraRevenues
    .filter(r => r?.date && within(r.date, b))
    .map(r => ({ date: r.date, description: (r.description || 'Other income').trim(), amount: n(r.amount) }))
    .sort((x, y) => instant(x.date) - instant(y.date));
  const otherRevenue = income.reduce((s, r) => s + r.amount, 0);

  // ── Cash in (Analytics' own function), and every payment behind it, by how it was paid.
  const invoiced = invoicedOrderIds(input.orders, input.invoices);
  const cashIn = cashInForPeriod({
    invoices: jewellery, orders: input.orders, invoiced, extraRevenues: input.extraRevenues, period: b,
    invoiceDate: inv => revenueDate(inv, ordersById),
  });
  const payments: PaymentRow[] = [];
  const pay = (p: Payment, ref: string, customer: string) => {
    if (!p || n(p.amount) <= 0 || !within(p.date, b)) return;
    payments.push({ date: p.date, ref, customer, method: p.method || 'Not recorded', amount: n(p.amount) });
  };
  for (const inv of input.invoices) {
    if (!inv || inv.status === 'Refunded') continue;
    for (const p of Array.isArray(inv.paymentHistory) ? inv.paymentHistory : []) pay(p, inv.id, (inv.customerName || 'Walk-in Customer').trim());
  }
  for (const o of input.orders) {
    if (!o || o.status === 'Cancelled' || o.status === 'Refunded' || invoiced.has(o.id)) continue;
    for (const p of orderAdvancePayments(o)) pay(p, o.id, (o.customerName || 'Walk-in Customer').trim());
  }
  payments.sort((x, y) => instant(x.date) - instant(y.date));
  const methods = new Map<string, number>();
  for (const p of payments) methods.set(p.method, (methods.get(p.method) ?? 0) + p.amount);

  // ── Expenses.
  const expenseRows: ExpenseRow[] = input.expenses
    .filter(e => e?.date && within(e.date, b))
    .map(e => ({ date: e.date, category: String(e.category || 'Other'), description: (e.description || '').trim(), amount: n(e.amount), business: isBusinessCost(e) }))
    .sort((x, y) => instant(x.date) - instant(y.date));
  const cats = new Map<string, number>();
  let business = 0, drawings = 0;
  for (const e of expenseRows) {
    if (e.business) { business += e.amount; cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount); } else drawings += e.amount;
  }

  const total = invoiceRevenue + openRevenue + otherRevenue;
  const prevMonth = addMonths(month, -1);
  const current = karachiMonth(now);
  const live = sales.filter(s => !s.refunded);

  return {
    month,
    label: monthLabel(month),
    from: b.from.toISOString(),
    to: b.to.toISOString(),
    partial: current.year === month.year && current.month === month.month,
    generatedAt: now.toISOString(),
    revenue: { invoices: invoiceRevenue, openOrders: openRevenue, other: otherRevenue, total, coins: coinRevenue },
    counts: {
      invoices: live.length,
      pieces,
      openOrders: openOrders.length,
      customers: new Set(live.map(s => s.customer.toLowerCase())).size,
      refunded: sales.length - live.length,
    },
    metal: [...metal].map(([label, grams]) => ({ label, grams })).sort((x, y) => y.grams - x.grams),
    cashIn,
    byMethod: [...methods].map(([method, amount]) => ({ method, amount })).sort((x, y) => y.amount - x.amount),
    expenses: { business, drawings, byCategory: [...cats].map(([category, amount]) => ({ category, amount })).sort((x, y) => y.amount - x.amount) },
    net: total - business,
    owed: {
      onThisMonth: live.reduce((s, x) => s + x.balance, 0),
      allOpen: input.invoices.reduce((s, inv) => s + (inv && inv.status !== 'Refunded' ? Math.max(0, n(inv.balanceDue)) : 0), 0),
    },
    previous: { label: monthLabel(prevMonth), ...figures(input, monthBounds(prevMonth), ordersById) },
    sales,
    openOrders,
    payments,
    income,
    expenseRows,
  };
}

/** The WhatsApp line under the PDF. */
export function monthlyCaption(r: MonthlyReport): string {
  const pkr = (v: number) => `PKR ${Math.round(v).toLocaleString('en-PK')}`;
  const change = (now: number, before: number) => {
    // A month still running against a whole one would read as a fall every time.
    if (!before || r.partial) return '';
    const pct = Math.round(((now - before) / Math.abs(before)) * 100);
    return ` (${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% on ${r.previous.label.split(' ')[0]})`;
  };
  return [
    `📊 *Monthly report — ${r.label}*${r.partial ? ' (so far)' : ''}`,
    `Revenue: ${pkr(r.revenue.total)}${change(r.revenue.total, r.previous.revenue)}`,
    `${r.counts.invoices} sale(s)${r.counts.openOrders ? `, ${r.counts.openOrders} open order(s)` : ''}${r.revenue.coins ? ` · coins ${pkr(r.revenue.coins)}` : ''}`,
    `Cash in: ${pkr(r.cashIn.total)} · Expenses: ${pkr(r.expenses.business)}`,
    `Every sale is listed in the PDF.`,
  ].join('\n');
}
