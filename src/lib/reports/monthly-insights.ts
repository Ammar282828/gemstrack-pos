/**
 * What the monthly report says beyond the sale lists: changes against last month and the same
 * month last year, a daily revenue series, twelve months of trend, rankings, the orders in
 * flight and the gold coins' own card. The owner, 2026-10-30: "the report should show trends
 * etc, analytics etc."
 *
 * Analytics' rules, followed exactly (monthly.ts says them in full):
 * - Revenue: jewellery invoices at `invoiceSaleValue`, on the order's day for an invoice made
 *   from an order; open orders at their subtotal on the day taken; other income. Refunded
 *   invoices and cancelled orders count nothing. Gold coins are a line of their own.
 * - Estimated profit: each sale at its own margin (`lib/margin.ts`: the typed 24k rate, else
 *   the house's assumed share), other income at the assumed share.
 * - Net profit = estimated profit less business expenses (`lib/analytics/net-profit.ts`) —
 *   never revenue less expenses; the margin is net / revenue.
 * - Karachi's days and months.
 *
 * A month still running is compared with the same days of the months it is set against, so a
 * half month never reads as a collapse.
 * Pure: monthly.ts calls it with what it already holds.
 */

import { cashInForPeriod, invoicedOrderIds } from '@/lib/analytics/cash-in';
import { splitAllCoinSales, isCoinItem } from '@/lib/analytics/coins';
import { netMarginPercent, netProfit } from '@/lib/analytics/net-profit';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { categoryTitle, lineCategory } from '@/lib/categories';
import { ASSUMED_MARGIN, invoiceMargin, orderMargin } from '@/lib/margin';
import { bookedAsSale } from '@/lib/order-stage';
import { isBusinessCost } from '@/lib/partnership';
import type { AdditionalRevenue, Expense, Invoice, Order } from '@/lib/store';
import { saleCustomerKey } from '@/lib/walk-in';
import { addMonths, instant, karachiDay, karachiMonth, monthBounds, monthKey, revenueDate, type MonthRef } from './monthly-time';

const n = (v: unknown) => Number(v) || 0;
const itemsOf = (inv: Invoice) => (Array.isArray(inv.items) ? inv.items : Object.values((inv.items || {}) as Record<string, Invoice['items'][number]>));
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface InsightsInput {
  invoices: Invoice[];
  orders: Order[];
  expenses: Expense[];
  extraRevenues: AdditionalRevenue[];
}

/** One figure now and before it. `pct` is null when there was nothing before to compare with. */
export interface Change { now: number; before: number; pct: number | null }

export function changeOf(now: number, before: number): Change {
  return { now, before, pct: before ? ((now - before) / Math.abs(before)) * 100 : null };
}

export interface HeadlineFigure {
  key: 'revenue' | 'profit' | 'expenses' | 'net' | 'cashIn' | 'sales';
  name: string;
  /** Rupees, or a count for `sales`. */
  money: boolean;
  now: number;
  vsLast: Change;
  vsYear: Change;
}

export interface TrendPoint { key: string; label: string; revenue: number; profit: number; expenses: number; net: number; partial: boolean }
export interface DayPoint { day: number; revenue: number }
export interface RankRow { name: string; amount: number; count: number }

export interface OrdersPipeline {
  /** Orders taken in the month (not cancelled) and what they come to. */
  taken: number;
  takenValue: number;
  /** Where those orders stand now. */
  nowPending: number;
  nowInProgress: number;
  nowReady: number;
  nowInvoiced: number;
  cancelled: number;
  /** Invoices written in the month from an order, whenever it was taken. */
  invoicedFromOrders: { count: number; value: number };
  /** Every open order, any month: not yet invoiced. */
  open: { count: number; value: number; advances: number; balance: number };
}

export interface WebInsights {
  visitors: Change;
  sessions: Change;
  enquiries: Change;
  saves: number;
  channels: { name: string; sessions: number }[];
}

export interface CoinCard {
  revenue: Change;
  invoices: number;
  grams: number;
}

export interface MonthlyInsights {
  /** What the figures are set against: "August" / "September 2025"; `throughDay` when only the first days are. */
  against: { last: string; year: string; throughDay: number | null };
  headline: HeadlineFigure[];
  /** Net profit as a share of revenue. */
  margin: Change;
  daily: DayPoint[];
  /** Twelve months and this one, oldest first. */
  trend: TrendPoint[];
  categories: RankRow[];
  products: RankRow[];
  customers: RankRow[];
  orders: OrdersPipeline;
  coins: CoinCard;
  /** Added by the server when the website's day counters are there. */
  web?: WebInsights;
}

/** One thing that counted on a day: revenue (with its profit), a coin sale, or an expense. */
interface Ev { day: string; revenue: number; profit: number; coin: number; expense: number; sale: number }

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function buildInsights(input: InsightsInput, month: MonthRef, now = new Date()): MonthlyInsights {
  const ordersById = new Map(input.orders.map(o => [o.id, o]));
  const { jewellery, coins } = splitAllCoinSales(input.invoices);
  const b = monthBounds(month);

  // ── Every dated event, once; the months and the days are sums of these.
  const evs: Ev[] = [];
  const ev = (day: string, e: Partial<Ev>) => { if (day) evs.push({ day, revenue: 0, profit: 0, coin: 0, expense: 0, sale: 0, ...e }); };
  for (const inv of jewellery) {
    if (!inv?.createdAt || inv.status === 'Refunded') continue;
    const v = invoiceSaleValue(inv);
    ev(karachiDay(revenueDate(inv, ordersById)), { revenue: v, profit: (v * invoiceMargin(inv).percent) / 100, sale: 1 });
  }
  for (const inv of coins) {
    if (!inv?.createdAt || inv.status === 'Refunded') continue;
    ev(karachiDay(revenueDate(inv, ordersById)), { coin: invoiceSaleValue(inv) });
  }
  for (const o of input.orders) {
    if (!bookedAsSale(o)) continue;
    ev(karachiDay(o.createdAt), { revenue: n(o.subtotal), profit: (n(o.subtotal) * orderMargin(o).percent) / 100, sale: 1 });
  }
  for (const r of input.extraRevenues) {
    if (r?.date) ev(karachiDay(r.date), { revenue: n(r.amount), profit: n(r.amount) * ASSUMED_MARGIN });
  }
  for (const e of input.expenses) {
    if (e?.date && isBusinessCost(e)) ev(karachiDay(e.date), { expense: n(e.amount) });
  }

  const sum = (m: MonthRef, upto?: number) => {
    const p = monthKey(m);
    const t = { revenue: 0, profit: 0, coin: 0, expense: 0, sale: 0 };
    for (const e of evs) {
      if (!e.day.startsWith(p) || (upto !== undefined && Number(e.day.slice(8, 10)) > upto)) continue;
      t.revenue += e.revenue; t.profit += e.profit; t.coin += e.coin; t.expense += e.expense; t.sale += e.sale;
    }
    return { ...t, net: netProfit(t.profit, t.expense) };
  };

  const current = karachiMonth(now);
  const partial = current.year === month.year && current.month === month.month;
  // The first days of the month it is set against, while this one is still running.
  const throughDay = partial ? Number(karachiDay(now.toISOString()).slice(8, 10)) : null;
  const last = addMonths(month, -1);
  const yearAgo = addMonths(month, -12);
  const cur = sum(month);
  const lastT = sum(last, throughDay ?? undefined);
  const yearT = sum(yearAgo, throughDay ?? undefined);

  const cashFor = (m: MonthRef, upto?: number) => {
    const mb = monthBounds(m);
    const period = upto === undefined ? mb : { from: mb.from, to: new Date(Math.min(mb.to.getTime(), mb.from.getTime() + upto * 86_400_000 - 1)) };
    return cashInForPeriod({
      invoices: jewellery, orders: input.orders, invoiced: invoicedOrderIds(input.orders, input.invoices),
      extraRevenues: input.extraRevenues, period, invoiceDate: inv => revenueDate(inv, ordersById),
    }).total;
  };
  const cashNow = cashFor(month), cashLast = cashFor(last, throughDay ?? undefined), cashYear = cashFor(yearAgo, throughDay ?? undefined);

  const fig = (key: HeadlineFigure['key'], name: string, money: boolean, a: number, l: number, y: number): HeadlineFigure =>
    ({ key, name, money, now: a, vsLast: changeOf(a, l), vsYear: changeOf(a, y) });
  const headline = [
    fig('revenue', 'Revenue', true, cur.revenue, lastT.revenue, yearT.revenue),
    fig('net', 'Net profit', true, cur.net, lastT.net, yearT.net),
    fig('cashIn', 'Cash in', true, cashNow, cashLast, cashYear),
    fig('expenses', 'Expenses', true, cur.expense, lastT.expense, yearT.expense),
    fig('profit', 'Estimated profit', true, cur.profit, lastT.profit, yearT.profit),
    fig('sales', 'Sales', false, cur.sale, lastT.sale, yearT.sale),
  ];
  const marginOf = (t: { net: number; revenue: number }) => netMarginPercent(t.net, t.revenue);
  const margin = { now: marginOf(cur), before: marginOf(lastT), pct: null as number | null };
  // A margin moves in points, not percent of itself: `pct` carries the points.
  margin.pct = lastT.revenue > 0 && cur.revenue > 0 ? margin.now - margin.before : null;

  // ── Daily revenue of the month.
  const days = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  const daily: DayPoint[] = Array.from({ length: days }, (_, i) => ({ day: i + 1, revenue: 0 }));
  const prefix = monthKey(month);
  for (const e of evs) if (e.day.startsWith(prefix) && e.revenue) daily[Number(e.day.slice(8, 10)) - 1].revenue += e.revenue;

  // ── Twelve months and this one.
  const trend: TrendPoint[] = Array.from({ length: 13 }, (_, i) => {
    const m = addMonths(month, i - 12);
    const t = sum(m);
    return {
      key: monthKey(m), label: `${SHORT[m.month - 1]}${m.month === 1 || i === 0 ? ` ${String(m.year).slice(2)}` : ''}`,
      revenue: t.revenue, profit: t.profit, expenses: t.expense, net: t.net,
      partial: m.year === current.year && m.month === current.month,
    };
  });

  // ── Rankings, from the month's jewellery invoices (and orders for customers), as Analytics ranks them.
  const cats = new Map<string, RankRow>();
  const prods = new Map<string, RankRow>();
  const custs = new Map<string, RankRow>();
  const bump = (map: Map<string, RankRow>, key: string, name: string, amount: number, count: number) => {
    const row = map.get(key) ?? { name, amount: 0, count: 0 };
    row.amount += amount; row.count += count;
    map.set(key, row);
  };
  for (const inv of jewellery) {
    if (!inv?.createdAt || inv.status === 'Refunded' || !karachiDay(revenueDate(inv, ordersById)).startsWith(prefix)) continue;
    const who = saleCustomerKey(inv);
    bump(custs, who, who === 'walk-in' ? 'Walk-in customers' : (inv.customerName || 'Customer').trim(), invoiceSaleValue(inv), 1);
    for (const item of itemsOf(inv)) {
      if (!item) continue;
      const total = n(item.itemTotal), qty = Math.max(1, n(item.quantity));
      const cat = lineCategory(item);
      bump(cats, cat || 'none', (cat && categoryTitle(cat)) || (cat ? String(cat) : 'Uncategorised'), total, qty);
      const sku = String(item.sku || item.name || 'piece');
      bump(prods, sku, String(item.name || item.sku || 'Piece').trim(), total, qty);
    }
  }
  for (const o of input.orders) {
    if (!bookedAsSale(o) || !karachiDay(o.createdAt).startsWith(prefix)) continue;
    const who = saleCustomerKey(o);
    bump(custs, who, who === 'walk-in' ? 'Walk-in customers' : (o.customerName || 'Customer').trim(), n(o.subtotal), 1);
  }
  const top = (map: Map<string, RankRow>, limit: number) => [...map.values()].filter(r => r.amount > 0).sort((x, y) => y.amount - x.amount || x.name.localeCompare(y.name)).slice(0, limit);

  // ── Orders in flight.
  const inMonth = (iso: string | undefined) => !!iso && karachiDay(iso).startsWith(prefix);
  const orders: OrdersPipeline = {
    taken: 0, takenValue: 0, nowPending: 0, nowInProgress: 0, nowReady: 0, nowInvoiced: 0, cancelled: 0,
    invoicedFromOrders: { count: 0, value: 0 },
    open: { count: 0, value: 0, advances: 0, balance: 0 },
  };
  for (const o of input.orders) {
    if (!o) continue;
    if (inMonth(o.createdAt)) {
      if (o.status === 'Cancelled' || o.status === 'Refunded') orders.cancelled++;
      else {
        orders.taken++;
        orders.takenValue += n(o.subtotal);
        if (o.invoiceId) orders.nowInvoiced++;
        else if (o.status === 'Completed') orders.nowReady++;
        else if (o.status === 'In Progress') orders.nowInProgress++;
        else orders.nowPending++;
      }
    }
    if (bookedAsSale(o)) {
      orders.open.count++;
      orders.open.value += n(o.subtotal);
      orders.open.advances += n(o.advancePayment);
      orders.open.balance += Math.max(0, n(o.subtotal) - n(o.advancePayment));
    }
  }
  for (const inv of input.invoices) {
    if (inv?.sourceOrderId && inv.status !== 'Refunded' && inv.createdAt && instant(inv.createdAt) >= b.from.getTime() && instant(inv.createdAt) <= b.to.getTime()) {
      orders.invoicedFromOrders.count++;
      orders.invoicedFromOrders.value += invoiceSaleValue(inv);
    }
  }

  // ── Gold coins: their own card, never in the figures above.
  let coinInvoices = 0, coinGrams = 0;
  for (const inv of coins) {
    if (!inv?.createdAt || inv.status === 'Refunded' || !karachiDay(revenueDate(inv, ordersById)).startsWith(prefix)) continue;
    coinInvoices++;
    for (const item of itemsOf(inv)) if (isCoinItem(item)) coinGrams += n(item.metalWeightG) * Math.max(1, n(item.quantity));
  }

  const name = (m: MonthRef, withYear: boolean) => `${MONTH_NAMES[m.month - 1]}${withYear ? ` ${m.year}` : ''}`;
  return {
    against: { last: name(last, last.year !== month.year), year: name(yearAgo, true), throughDay },
    headline,
    margin,
    daily,
    trend,
    categories: top(cats, 8),
    products: top(prods, 8),
    customers: top(custs, 8),
    orders,
    coins: { revenue: changeOf(cur.coin, lastT.coin), invoices: coinInvoices, grams: coinGrams },
  };
}
