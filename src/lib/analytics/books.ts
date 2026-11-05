/**
 * The shop's books for a period: every figure Analytics shows, worked out in one place.
 *
 * This is the arithmetic that used to live inside analytics-view.tsx (`analyticsData`, `yearlySummary`,
 * `monthlyRevenue`), moved out unchanged so the Overview and its sub pages read the same numbers and a test can
 * hold them. Pure functions: no React, no store. Every money rule is the one the owner already settled:
 *
 *  - coins apart from everything (coins.ts), shown only in `coinSummary`;
 *  - a sale is worth `invoiceSaleValue` (exchange added back), on its order's date (`getInvoiceRevenueDate`);
 *  - a sale at its own margin (margin.ts), extra revenue at the assumed one;
 *  - an order counts as a sale only while `bookedAsSale` (not yet an invoice, not cancelled, not awaiting a transfer);
 *  - profit before running costs is `profitBeforeRunning` (revenue less goods where the house records them), net profit
 *    that less the running costs only (net-profit.ts);
 *  - cash in is `cashInForPeriod`; credit handed back is shown as money out and added back to money in.
 *
 * One deliberate difference from the component: cash was left at 0 when the period had no sale, order, expense or extra
 * revenue at all, even if money was collected on older bills in it. Cash is now always worked out, so a month spent
 * collecting old balances shows them (the monthly Cash chart needs it).
 *
 * Metal weight counts the house's metal (`STORE_CONFIG.defaultMetal`, overridable with `opts.metal`), not only gold,
 * so House of Mina sees its silver.
 */

import {
  addDays, addMonths, addWeeks, differenceInCalendarDays, eachMonthOfInterval, endOfDay, endOfMonth, format, getYear,
  parseISO, startOfDay, startOfMonth, startOfWeek, subDays, subMonths, subYears,
} from 'date-fns';
import type {
  AdditionalRevenue, Category, Customer, Expense, Invoice, InvoiceItem, Order, Product,
} from '@/lib/store';
import { CUSTOMER_SOURCES, CUSTOMER_SOURCE_LABELS, getInvoiceRevenueDate, type CustomerSource } from '@/lib/store';
import { ASSUMED_MARGIN, invoiceMargin, orderMargin } from '@/lib/margin';
import { splitAllCoinSales, summariseCoins, type CoinSummary } from '@/lib/analytics/coins';
import { cashInForPeriod, invoicedOrderIds } from '@/lib/analytics/cash-in';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { netProfit as netProfitOf, netMarginPercent, isRunningCost, profitBeforeRunning } from '@/lib/analytics/net-profit';
import { isGoodsExpense } from '@/lib/expense-categories';
import { bookedAsSale } from '@/lib/order-stage';
import { lineCategory } from '@/lib/categories';
import { saleCustomerKey, WALK_IN_ENTITY, WALK_IN_NAME } from '@/lib/walk-in';
import { STORE_CONFIG } from '@/lib/store-config';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BooksInput {
  invoices: Invoice[];
  orders: Order[];
  products: Product[];
  categories: Category[];
  customers: Customer[];
  expenses: Expense[];
  additionalRevenues: AdditionalRevenue[];
}

/** A period. `from` missing (or no range at all) is all time; `to` missing is today. */
export interface RangeLike { from?: Date | null; to?: Date | null }

export interface BooksOptions {
  /** "Today", for tests and for a page that wants one clock. */
  now?: Date;
  /** The metal whose weight counts as "metal sold"; the house's own by default. */
  metal?: 'gold' | 'silver';
}

export type SalesOverTimeData = { date: string; sales: number; orders: number; itemsSold: number };
export type TopProductData = { sku: string; name: string; quantity: number; revenue: number };
export type SalesByCategoryData = { categoryId: string; categoryName: string; sales: number };
export type TopCustomerData = { key: string; customerId?: string; customerName: string; totalSpent: number; orderCount: number };
export type ExpenseKind = 'running' | 'goods' | 'drawings';
export type ExpenseByCategoryData = { category: string; amount: number; kind: ExpenseKind };
export type SourceBreakdownData = { key: string; label: string; revenue: number; orderCount: number; avgOrderValue: number };
export type SourceTrendData = { date: string } & Record<string, number | string>;

/** One weekday's average (Monday = 0 … Sunday = 6). */
export interface WeekdayRow {
  weekday: number;
  label: string;
  /** Revenue on that weekday across the period. */
  revenue: number;
  /** How many of that weekday the period holds (days with no sale count as 0 in the average). */
  days: number;
  /** `revenue / days`. */
  avg: number;
  /** Sales (invoices and orders) on that weekday. */
  count: number;
}

export interface ReceivableRow {
  /** The invoice id; its page is `/invoices/<id>`. */
  id: string;
  customerName: string;
  customerId?: string;
  /** The day it counts for (its order's date when made from one). */
  date: string;
  /** Jewellery and coin part together. */
  balanceDue: number;
  /** Of which on coins. */
  coinDue: number;
}

export interface ExpenseRow { id: string; date: string; category: string; description: string; amount: number; kind: ExpenseKind }

export interface MetalKaratRow { karat: string; grams: number; pieces: number }

/** Customers who bought on one day, split by whether that was their first-ever sale. */
export interface CustomerDay { date: string; newKeys: string[]; returningKeys: string[] }

export interface Books {
  // ── Revenue (jewellery only; coins apart) ──
  totalSales: number;
  invoiceSales: number;
  orderSales: number;
  extraRevenue: number;
  totalUnpaid: number;
  /** Invoices plus uninvoiced orders (extra revenue is not an order). */
  totalOrders: number;
  averageOrderValue: number;
  totalItemsSold: number;
  totalDiscounts: number;
  averageItemsPerOrder: number;
  // ── What was earned ──
  /** Each sale at its own margin, before the house's goods are looked at (`profitBeforeRunning` input). */
  estProfit: number;
  salesCosted: number;
  salesCount: number;
  /** Profit before running costs: `profitBeforeRunning` (Mina: revenue less goods, Gross profit). */
  estProfitAdj: number;
  /** Revenue less `estProfitAdj`: what the pieces cost (estimated at Taheri, goods bought at Mina). */
  costOfPieces: number;
  /** `estProfitAdj` less the running costs only. */
  netProfit: number;
  /** In percent of revenue. */
  netMargin: number;
  // ── Metal, by weight (the house's metal; coins are not in here) ──
  metalGrams: number;
  metalPieces: number;
  /** Heaviest karat first. */
  metalByKarat: MetalKaratRow[];
  // ── Series and rankings ──
  salesOverTime: SalesOverTimeData[];
  topProductsByRevenue: TopProductData[];
  topProductsByQuantity: TopProductData[];
  salesByCategory: SalesByCategoryData[];
  topCustomers: TopCustomerData[];
  byWeekday: WeekdayRow[];
  /** Invoices / orders not invoiced yet / extra revenue, in that order, zeros kept. */
  revenueMix: { key: 'invoices' | 'orders' | 'extra'; label: string; value: number }[];
  // ── Expenses ──
  totalExpenses: number;
  runningExpenses: number;
  goodsExpenses: number;
  /** Expenses that are neither running costs nor goods: partners' drawings. */
  drawingsExpenses: number;
  expenseKinds: Record<ExpenseKind, number>;
  expensesByCategory: ExpenseByCategoryData[];
  /** The ten biggest single expenses of the period. */
  largestExpenses: ExpenseRow[];
  // ── Cash flow ──
  cashIn: number;
  cashInFromInvoicePayments: number;
  cashInFromOrderAdvances: number;
  cashInFromExtraRevenue: number;
  cashInFromExchange: number;
  exchangeOffInvoices: number;
  cashOut: number;
  /** The three kinds of expense, as money out (`cashOut` is their sum plus `creditPaidBack`). */
  cashOutRunning: number;
  cashOutGoods: number;
  cashOutDrawings: number;
  creditPaidBack: number;
  netCashFlow: number;
  /** Revenue less the cash that came in on it: what is still to collect (exchange off a bill is not revenue). */
  accrualVsCashGap: number;
  // ── Who still owes (this period's sales, largest first) ──
  receivables: ReceivableRow[];
  receivablesTotal: number;
  // ── Customers ──
  /** Named customers (walk-ins left out) whose first-ever sale falls in the period. */
  newCustomers: number;
  /** Named customers who bought in the period but had bought before it. */
  returningCustomers: number;
  revenueFromNew: number;
  revenueFromReturning: number;
  /** Per day, for the new-vs-returning chart; use `bucketCustomerFlow`. */
  customerDays: CustomerDay[];
  // ── Acquisition source ──
  sourceBreakdown: SourceBreakdownData[];
  sourceTrend: SourceTrendData[];
  sourceActiveKeys: string[];
  // ── Coins, apart ──
  coinSummary: CoinSummary;
  /** The house has coin sales at all (any period): the Metal page shows its coin section only then. */
  hasCoins: boolean;
  // ── The period itself ──
  /** Jewellery invoices in the period, newest data as stored; for the day dialog. */
  invoices: Invoice[];
  /** The same invoices by the day they count for (yyyy-MM-dd). */
  invoicesByDay: Record<string, Invoice[]>;
  /** A range was chosen and holds no invoice and no order (the old "Nothing in this range"). */
  rangeEmpty: boolean;
}

// ── Sources ─────────────────────────────────────────────────────────────────

// Acquisition-source buckets: the configured sources plus an "unclassified" catch-all for sales with no source on the
// record or customer.
export const UNCLASSIFIED_KEY = 'unclassified';
export const SOURCE_KEYS: string[] = [...CUSTOMER_SOURCES, UNCLASSIFIED_KEY];
export const SOURCE_LABELS: Record<string, string> = { ...CUSTOMER_SOURCE_LABELS, [UNCLASSIFIED_KEY]: 'Unclassified' };

// ── The shared preparation ──────────────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayKey = (d: Date) => format(startOfDay(d), 'yyyy-MM-dd');
const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;
const kindOf = (e: { category?: string | null }): ExpenseKind => (isRunningCost(e) ? 'running' : isGoodsExpense(e) ? 'goods' : 'drawings');

interface Dated<T> { item: T; t: number }

/** Everything that does not depend on the period, worked out once so a year of months does not redo it. */
interface Prepared {
  input: BooksInput;
  now: Date;
  metal: 'gold' | 'silver';
  ordersById: Map<string, Order>;
  customersById: Map<string, Customer>;
  productsBySku: Map<string, Product>;
  categoriesById: Map<string, Category>;
  jewellery: Dated<Invoice>[];
  coins: Dated<Invoice>[];
  orders: Dated<Order>[];
  expenses: Dated<Expense>[];
  extras: Dated<AdditionalRevenue>[];
  invoiced: Set<string>;
  /** Customer key -> time of the customer's first-ever sale, walk-ins excluded. */
  firstSale: Map<string, number>;
}

const timeOf = (iso: string | undefined | null): number => (iso ? parseISO(iso).getTime() : NaN);

function prepare(input: BooksInput, opts: BooksOptions = {}): Prepared {
  const now = opts.now ?? new Date();
  const orders = (input.orders || []).filter(Boolean);
  const invoices = (input.invoices || []).filter(Boolean);
  const ordersById = new Map(orders.map(o => [o.id, o]));
  const customersById = new Map((input.customers || []).map(c => [c.id, c]));
  const firstOf = <T,>(rows: T[], id: (r: T) => string) => { const m = new Map<string, T>(); for (const r of rows) { const k = id(r); if (!m.has(k)) m.set(k, r); } return m; };
  const { jewellery, coins } = splitAllCoinSales(invoices);
  const dated = (list: Invoice[]): Dated<Invoice>[] =>
    list.filter(inv => inv.createdAt && inv.status !== 'Refunded')
      .map(inv => ({ item: inv, t: timeOf(getInvoiceRevenueDate(inv, ordersById)) })).filter(d => !Number.isNaN(d.t));

  // The first time each named customer bought anything: any invoice (coins too) or order that counts as a sale.
  const firstSale = new Map<string, number>();
  const seen = (sale: { customerId?: string | null; customerName?: string | null }, t: number) => {
    if (Number.isNaN(t)) return;
    const key = saleCustomerKey(sale, id => customersById.get(id)?.name);
    if (key === WALK_IN_ENTITY) return;
    const prev = firstSale.get(key);
    if (prev === undefined || t < prev) firstSale.set(key, t);
  };
  for (const inv of invoices) if (inv.createdAt && inv.status !== 'Refunded') seen(inv, timeOf(getInvoiceRevenueDate(inv, ordersById)));
  for (const o of orders) if (bookedAsSale(o)) seen(o, timeOf(o.createdAt));

  return {
    input, now, metal: opts.metal ?? STORE_CONFIG.defaultMetal, ordersById, customersById,
    productsBySku: firstOf(input.products || [], p => p.sku),
    categoriesById: firstOf(input.categories || [], c => c.id),
    jewellery: dated(jewellery),
    coins: dated(coins),
    orders: orders.filter(bookedAsSale).map(o => ({ item: o, t: timeOf(o.createdAt) })).filter(d => !Number.isNaN(d.t)),
    expenses: (input.expenses || []).filter(Boolean).map(e => ({ item: e, t: timeOf(e.date) })),
    extras: (input.additionalRevenues || []).filter(r => r?.date).map(r => ({ item: r, t: timeOf(r.date) })).filter(d => !Number.isNaN(d.t)),
    invoiced: invoicedOrderIds(orders, invoices),
    firstSale,
  };
}

/** The period as the old page read it: no `from` is all time; no `to` runs to today. */
function boundsOf(range: RangeLike | null | undefined, now: Date) {
  const from = range?.from ? startOfDay(range.from) : null;
  const to = range?.to ? endOfDay(range.to) : (range?.from ? endOfDay(now) : null);
  return {
    // What filters the sales: only with a `from`.
    start: from ? from.getTime() : null,
    end: from ? (to as Date).getTime() : null,
    // What bounds the cash: the old page let a lone `to` bound it.
    cashFrom: from,
    cashTo: to,
  };
}

const inside = (t: number, start: number | null, end: number | null) => start === null || (t >= start && t <= (end as number));

// ── The books for a period ──────────────────────────────────────────────────

/**
 * Every figure Analytics shows for `range` (see the file comment for the rules). A pure function of its inputs.
 */
export function computeBooks(input: BooksInput, range: RangeLike | null | undefined, opts: BooksOptions = {}): Books {
  return computeWith(prepare(input, opts), range);
}

function computeWith(p: Prepared, range: RangeLike | null | undefined): Books {
  const { start, end, cashFrom, cashTo } = boundsOf(range, p.now);
  const filteredInvoices = p.jewellery.filter(d => inside(d.t, start, end)).map(d => d.item);
  const filteredCoinInvoices = p.coins.filter(d => inside(d.t, start, end)).map(d => d.item);
  const filteredOrders = p.orders.filter(d => inside(d.t, start, end)).map(d => d.item);
  const filteredExpenses = p.expenses.filter(d => start === null || inside(d.t, start, end)).map(d => d.item);
  const filteredExtras = p.extras.filter(d => inside(d.t, start, end)).map(d => d.item);

  const { customersById } = p;
  // Invoices carry the channel on `acquisitionSource` (the bare `source` field is reserved for Shopify import
  // tagging); orders carry it on `source`. An explicit override wins, else the linked customer's saved source.
  const resolveSource = (recSource: CustomerSource | undefined, customerId?: string): string => {
    if (recSource) return recSource;
    if (customerId) {
      const c = customersById.get(customerId);
      if (c?.source) return c.source;
    }
    return UNCLASSIFIED_KEY;
  };
  const sourceAgg: Record<string, { revenue: number; orderCount: number }> = {};
  const sourceByDate: Record<string, Record<string, number>> = {};
  const accrueSource = (key: string, dateKey: string, amount: number) => {
    if (!sourceAgg[key]) sourceAgg[key] = { revenue: 0, orderCount: 0 };
    sourceAgg[key].revenue += amount;
    sourceAgg[key].orderCount += 1;
    if (!sourceByDate[dateKey]) sourceByDate[dateKey] = {};
    sourceByDate[dateKey][key] = (sourceByDate[dateKey][key] || 0) + amount;
  };

  let totalSales = 0, invoiceSalesAcc = 0;
  let estProfit = 0, salesCosted = 0, salesCount = 0;
  let totalItemsSold = 0;
  let metalGrams = 0, metalPieces = 0;
  const metalByKarat: Record<string, { grams: number; pieces: number }> = {};
  let totalDiscounts = 0, totalUnpaid = 0;
  const salesByDate: Record<string, { sales: number; orders: number; itemsSold: number }> = {};
  const productPerformance: Record<string, { quantity: number; revenue: number; name?: string }> = {};
  const categoryPerformance: Record<string, number> = {};
  const customerPerformance: Record<string, { totalSpent: number; orderCount: number; resolvedName?: string }> = {};
  const weekdayCount = [0, 0, 0, 0, 0, 0, 0];
  const customerDay: Record<string, Set<string>> = {};
  const invoicesByDay: Record<string, Invoice[]> = {};
  const day = (k: string) => (salesByDate[k] ??= { sales: 0, orders: 0, itemsSold: 0 });
  const seenOnDay = (dateKey: string, customerKey: string) => {
    if (customerKey === WALK_IN_ENTITY) return;
    (customerDay[dateKey] ??= new Set()).add(customerKey);
  };

  filteredInvoices.forEach(invoice => {
    const invAmount = invoiceSaleValue(invoice);
    totalSales += invAmount;
    invoiceSalesAcc += invAmount;
    const invMargin = invoiceMargin(invoice);
    estProfit += invAmount * invMargin.percent / 100;
    salesCount += 1;
    if (!invMargin.assumed) salesCosted += 1;
    totalDiscounts += invoice.discountAmount || 0;
    totalUnpaid += Math.max(0, invoice.balanceDue || 0);

    const revenueDate = startOfDay(parseISO(getInvoiceRevenueDate(invoice, p.ordersById)));
    const dateKey = format(revenueDate, 'yyyy-MM-dd');
    const d = day(dateKey);
    d.sales += invAmount;
    d.orders += 1;
    weekdayCount[weekdayIndex(revenueDate)] += 1;
    (invoicesByDay[dateKey] ??= []).push(invoice);

    accrueSource(resolveSource(invoice.acquisitionSource, invoice.customerId), dateKey, invAmount);

    // The customer, else the stored name (so named customers without a linked account aren't all collapsed into
    // "Walk-in"), else the one walk-in row (lib/walk-in.ts).
    const customerKey = saleCustomerKey(invoice, id => customersById.get(id)?.name);
    if (!customerPerformance[customerKey]) {
      customerPerformance[customerKey] = { totalSpent: 0, orderCount: 0, resolvedName: invoice.customerName || undefined };
    }
    customerPerformance[customerKey].totalSpent += invAmount;
    customerPerformance[customerKey].orderCount += 1;
    seenOnDay(dateKey, customerKey);

    if (Array.isArray(invoice.items)) {
      invoice.items.forEach((item: InvoiceItem) => {
        if (!item) return;
        const quantity = item.quantity || 0;
        const itemTotal = item.itemTotal || 0;

        totalItemsSold += quantity;
        d.itemsSold += quantity;

        // The metal actually sold. A piece with no recorded weight adds nothing rather than a guess, and the
        // page says how many were weighed.
        if (item.metalType === p.metal) {
          const g = (Number(item.metalWeightG) || 0) * (quantity || 1);
          if (g > 0) {
            metalGrams += g;
            metalPieces += quantity || 1;
            const k = (item.karat || 'unknown').toString();
            if (!metalByKarat[k]) metalByKarat[k] = { grams: 0, pieces: 0 };
            metalByKarat[k].grams += g;
            metalByKarat[k].pieces += quantity || 1;
          }
        }

        if (!productPerformance[item.sku]) productPerformance[item.sku] = { quantity: 0, revenue: 0, name: item.name };
        productPerformance[item.sku].quantity += quantity;
        productPerformance[item.sku].revenue += itemTotal;

        // Its own category, else its order's, else its name's (lib/categories.ts lineCategory).
        const cat = lineCategory(item);
        if (cat) categoryPerformance[cat] = (categoryPerformance[cat] || 0) + itemTotal;
      });
    }
  });

  // Uninvoiced orders into revenue. Use subtotal (the full order value): grandTotal is subtotal minus advance, which
  // would understate revenue since the advance is still earned income.
  let orderSales = 0;
  filteredOrders.forEach(order => {
    const amount = order.subtotal || 0;
    totalSales += amount;
    orderSales += amount;
    const ordMargin = orderMargin(order);
    estProfit += amount * ordMargin.percent / 100;
    salesCount += 1;
    if (!ordMargin.assumed) salesCosted += 1;

    const orderDate = startOfDay(parseISO(order.createdAt));
    const dateKey = format(orderDate, 'yyyy-MM-dd');
    const d = day(dateKey);
    d.sales += amount;
    d.orders += 1;
    weekdayCount[weekdayIndex(orderDate)] += 1;

    accrueSource(resolveSource(order.source, order.customerId), dateKey, amount);

    const customerKey = saleCustomerKey(order, id => customersById.get(id)?.name);
    if (!customerPerformance[customerKey]) {
      customerPerformance[customerKey] = { totalSpent: 0, orderCount: 0, resolvedName: order.customerName || undefined };
    }
    customerPerformance[customerKey].totalSpent += amount;
    customerPerformance[customerKey].orderCount += 1;
    seenOnDay(dateKey, customerKey);
  });

  // Extra revenue, before salesOverTime is read so it shows in the chart.
  let extraRevenue = 0;
  filteredExtras.forEach(r => {
    const amount = r.amount || 0;
    totalSales += amount;
    extraRevenue += amount;
    estProfit += amount * ASSUMED_MARGIN;
    day(format(startOfDay(parseISO(r.date)), 'yyyy-MM-dd')).sales += amount;
  });

  const totalOrders = filteredInvoices.length + filteredOrders.length;
  const orderRevenueTotal = invoiceSalesAcc + orderSales;

  // ── Expenses ──
  let totalExpenses = 0, runningExpenses = 0, goodsExpenses = 0;
  const expenseByCategoryMap: Record<string, number> = {};
  filteredExpenses.forEach(expense => {
    totalExpenses += expense.amount || 0;
    if (isRunningCost(expense)) runningExpenses += expense.amount || 0;
    else if (isGoodsExpense(expense)) goodsExpenses += expense.amount || 0;
    if (expense.category) expenseByCategoryMap[expense.category] = (expenseByCategoryMap[expense.category] || 0) + (expense.amount || 0);
  });
  const drawingsExpenses = totalExpenses - runningExpenses - goodsExpenses;
  const expensesByCategory = Object.entries(expenseByCategoryMap)
    .map(([category, amount]) => ({ category, amount, kind: kindOf({ category }) }))
    .sort((a, b) => b.amount - a.amount);
  const largestExpenses: ExpenseRow[] = [...filteredExpenses]
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 10)
    .map(e => ({ id: e.id, date: e.date, category: e.category, description: e.description, amount: e.amount || 0, kind: kindOf(e) }));

  const salesOverTime = Object.entries(salesByDate)
    .map(([date, data]) => ({ date, sales: data.sales, orders: data.orders, itemsSold: data.itemsSold }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const productRows = Object.entries(productPerformance).map(([sku, data]) => ({
    sku, name: p.productsBySku.get(sku)?.name || data.name || 'Unnamed piece', quantity: data.quantity, revenue: data.revenue,
  }));
  const topProductsByRevenue = [...productRows].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const topProductsByQuantity = [...productRows].sort((a, b) => b.quantity - a.quantity).slice(0, 10);

  const salesByCategory = Object.entries(categoryPerformance)
    .map(([categoryId, sales]) => ({ categoryId, categoryName: p.categoriesById.get(categoryId)?.title || 'Uncategorized', sales }))
    .sort((a, b) => b.sales - a.sales);

  const topCustomers = Object.entries(customerPerformance)
    .map(([key, data]) => {
      if (key === WALK_IN_ENTITY) {
        return { key, customerId: undefined, customerName: WALK_IN_NAME, totalSpent: data.totalSpent, orderCount: data.orderCount };
      }
      if (key.startsWith('name:')) {
        // Named customer without a linked account: the stored name directly.
        return { key, customerId: undefined, customerName: key.slice(5), totalSpent: data.totalSpent, orderCount: data.orderCount };
      }
      // Linked customer: the current name from the book.
      return {
        key, customerId: key, customerName: customersById.get(key)?.name || data.resolvedName || WALK_IN_NAME,
        totalSpent: data.totalSpent, orderCount: data.orderCount,
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // ── New and returning: a named customer is new when their first-ever sale falls in the period ──
  let newCustomers = 0, returningCustomers = 0, revenueFromNew = 0, revenueFromReturning = 0;
  for (const [key, data] of Object.entries(customerPerformance)) {
    if (key === WALK_IN_ENTITY) continue;
    const first = p.firstSale.get(key);
    const isNew = start === null || (first !== undefined && first >= start);
    if (isNew) { newCustomers += 1; revenueFromNew += data.totalSpent; } else { returningCustomers += 1; revenueFromReturning += data.totalSpent; }
  }
  const customerDays: CustomerDay[] = Object.keys(customerDay).sort().map(date => {
    const row: CustomerDay = { date, newKeys: [], returningKeys: [] };
    customerDay[date].forEach(key => {
      const first = p.firstSale.get(key);
      (first !== undefined && dayKey(new Date(first)) === date ? row.newKeys : row.returningKeys).push(key);
    });
    return row;
  });

  // ── By weekday: the average over the weekdays the period holds, quiet days counted as 0 ──
  const spanStart = start !== null ? new Date(start) : (salesOverTime.length ? parseISO(salesOverTime[0].date) : null);
  const spanEndRaw = start !== null ? new Date(end as number) : (salesOverTime.length ? parseISO(salesOverTime[salesOverTime.length - 1].date) : null);
  const spanEnd = spanEndRaw && spanEndRaw.getTime() > p.now.getTime() ? p.now : spanEndRaw;
  const weekdayDays = [0, 0, 0, 0, 0, 0, 0];
  if (spanStart && spanEnd) {
    for (let d = startOfDay(spanStart); d.getTime() <= spanEnd.getTime(); d = addDays(d, 1)) weekdayDays[weekdayIndex(d)] += 1;
  }
  const weekdayRevenue = [0, 0, 0, 0, 0, 0, 0];
  for (const row of salesOverTime) weekdayRevenue[weekdayIndex(parseISO(row.date))] += row.sales;
  const byWeekday: WeekdayRow[] = WEEKDAYS.map((label, i) => ({
    weekday: i, label, revenue: weekdayRevenue[i], days: weekdayDays[i],
    avg: weekdayDays[i] > 0 ? weekdayRevenue[i] / weekdayDays[i] : 0, count: weekdayCount[i],
  }));

  // ── Acquisition source: the canonical order, the real sources leading and Unclassified trailing ──
  const sourceBreakdown = SOURCE_KEYS
    .filter(key => sourceAgg[key] && sourceAgg[key].orderCount > 0)
    .map(key => {
      const agg = sourceAgg[key];
      return { key, label: SOURCE_LABELS[key], revenue: agg.revenue, orderCount: agg.orderCount, avgOrderValue: agg.orderCount > 0 ? agg.revenue / agg.orderCount : 0 };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const sourceActiveKeys = SOURCE_KEYS.filter(key => sourceAgg[key] && sourceAgg[key].orderCount > 0);
  // One row per date (chronological) with a value for every active source, missing keys 0 so the lines stay continuous.
  const sourceTrend = Object.keys(sourceByDate)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .map(date => {
      const row: SourceTrendData = { date };
      sourceActiveKeys.forEach(key => { row[key] = sourceByDate[date][key] || 0; });
      return row;
    });

  // ── Cash flow ──
  // In: invoice payments collected in the period (on ALL invoices: a payment may belong to an older bill), cash
  // advances on orders not invoiced yet, gold taken in exchange (which the owner counts as cash) and extra revenue; a
  // finalised order's advances are its invoice's payments and counted there only (cash-in.ts). Out: every expense paid
  // in the period. Credit handed back is a negative payment on its invoice, so cash-in.ts nets it off the payments;
  // here it is money out instead and added back to money in, so the net is the same.
  const cash = cashInForPeriod({
    invoices: p.jewellery.map(d => d.item),
    orders: p.input.orders,
    invoiced: p.invoiced,
    extraRevenues: p.input.additionalRevenues,
    period: { from: cashFrom, to: cashTo },
    invoiceDate: inv => getInvoiceRevenueDate(inv, p.ordersById),
  });
  const cashIn = cash.total + cash.paidBack;
  const cashOut = totalExpenses + cash.paidBack;
  // Gold taken off an invoice's total is in Cash In but was never in revenue.
  const accrualVsCashGap = totalSales - (cashIn - cash.paidBack - cash.exchangeOffInvoices);

  // ── Who still owes: this period's bills, jewellery and coins, largest first ──
  const owed = new Map<string, ReceivableRow>();
  const addOwed = (inv: Invoice, coin: boolean) => {
    const due = Math.max(0, inv.balanceDue || 0);
    if (due <= 0) return;
    const row = owed.get(inv.id) ?? { id: inv.id, customerName: inv.customerName || WALK_IN_NAME, customerId: inv.customerId, date: getInvoiceRevenueDate(inv, p.ordersById), balanceDue: 0, coinDue: 0 };
    row.balanceDue += due;
    if (coin) row.coinDue += due;
    owed.set(inv.id, row);
  };
  filteredInvoices.forEach(inv => addOwed(inv, false));
  filteredCoinInvoices.forEach(inv => addOwed(inv, true));
  const receivables = [...owed.values()].sort((a, b) => b.balanceDue - a.balanceDue);

  const estProfitAdj = profitBeforeRunning({ estimated: estProfit, revenue: totalSales, goods: goodsExpenses });
  const netProfit = netProfitOf(estProfitAdj, runningExpenses);

  return {
    totalSales, invoiceSales: invoiceSalesAcc, orderSales, extraRevenue, totalUnpaid, totalOrders,
    averageOrderValue: totalOrders > 0 ? orderRevenueTotal / totalOrders : 0,
    totalItemsSold, totalDiscounts,
    averageItemsPerOrder: totalOrders > 0 ? totalItemsSold / totalOrders : 0,
    estProfit, salesCosted, salesCount, estProfitAdj, costOfPieces: totalSales - estProfitAdj,
    netProfit, netMargin: netMarginPercent(netProfit, totalSales),
    metalGrams, metalPieces,
    // Heaviest karat first: what the shop mostly sells leads.
    metalByKarat: Object.entries(metalByKarat).map(([karat, v]) => ({ karat, ...v })).sort((a, b) => b.grams - a.grams),
    salesOverTime, topProductsByRevenue, topProductsByQuantity, salesByCategory, topCustomers, byWeekday,
    revenueMix: [
      { key: 'invoices', label: 'Invoices', value: invoiceSalesAcc },
      { key: 'orders', label: 'Orders not invoiced yet', value: orderSales },
      { key: 'extra', label: 'Extra revenue', value: extraRevenue },
    ],
    totalExpenses, runningExpenses, goodsExpenses, drawingsExpenses,
    expenseKinds: { running: runningExpenses, goods: goodsExpenses, drawings: drawingsExpenses },
    expensesByCategory, largestExpenses,
    cashIn,
    cashInFromInvoicePayments: cash.invoicePayments + cash.paidBack,
    cashInFromOrderAdvances: cash.orderAdvances,
    cashInFromExtraRevenue: cash.extraRevenue,
    cashInFromExchange: cash.exchange,
    exchangeOffInvoices: cash.exchangeOffInvoices,
    cashOut, cashOutRunning: runningExpenses, cashOutGoods: goodsExpenses, cashOutDrawings: drawingsExpenses,
    creditPaidBack: cash.paidBack, netCashFlow: cashIn - cashOut, accrualVsCashGap,
    receivables, receivablesTotal: receivables.reduce((s, r) => s + r.balanceDue, 0),
    newCustomers, returningCustomers, revenueFromNew, revenueFromReturning, customerDays,
    sourceBreakdown, sourceTrend, sourceActiveKeys,
    coinSummary: summariseCoins(filteredCoinInvoices),
    hasCoins: p.coins.length > 0,
    invoices: filteredInvoices, invoicesByDay,
    rangeEmpty: filteredInvoices.length === 0 && filteredOrders.length === 0 && start !== null,
  };
}

// ── The period before ───────────────────────────────────────────────────────

export interface PreviousPeriod {
  range: { from: Date; to: Date };
  /** After "vs": "last month", "last year", "previous 7 days". */
  label: string;
}

/**
 * The period to compare with. A whole or month-to-date calendar month is compared with the same days of the month
 * before ("vs last month", so 1–5 November meets 1–5 October, not a stray week of October); a year or year-to-date with
 * the same span of the year before; anything else with the same number of days immediately before it. `null` for all
 * time (no `from`).
 */
export function previousPeriod(range: RangeLike | null | undefined, now: Date = new Date()): PreviousPeriod | null {
  if (!range?.from) return null;
  const from = startOfDay(range.from);
  const to = endOfDay(range.to ?? now);
  const days = differenceInCalendarDays(to, from) + 1;
  if (days < 1) return null;
  if (from.getDate() === 1 && to.getFullYear() === from.getFullYear() && to.getMonth() === from.getMonth()) {
    const prevFrom = startOfMonth(subMonths(from, 1));
    const prevTo = endOfDay(new Date(Math.min(addDays(prevFrom, to.getDate() - 1).getTime(), endOfMonth(prevFrom).getTime())));
    return { range: { from: prevFrom, to: prevTo }, label: 'last month' };
  }
  if (from.getMonth() === 0 && from.getDate() === 1 && to.getFullYear() === from.getFullYear()) {
    return { range: { from: subYears(from, 1), to: endOfDay(subYears(to, 1)) }, label: 'last year' };
  }
  return {
    range: { from: startOfDay(subDays(from, days)), to: endOfDay(subDays(from, 1)) },
    label: days === 1 ? 'the day before' : `previous ${days} days`,
  };
}

/** `previousPeriod`'s range alone. */
export function previousRange(range: RangeLike | null | undefined, now: Date = new Date()): { from: Date; to: Date } | null {
  return previousPeriod(range, now)?.range ?? null;
}

// ── Sales over time, by day, week or month ──────────────────────────────────

export type Bucket = 'day' | 'week' | 'month';

/** The default grain for a period: days up to 45 of them, weeks up to 200, else months (all time: months). */
export function autoBucket(range: RangeLike | null | undefined, now: Date = new Date()): Bucket {
  if (!range?.from) return 'month';
  const days = differenceInCalendarDays(endOfDay(range.to ?? now), startOfDay(range.from)) + 1;
  return days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
}

export interface BucketRow {
  /** The bucket's first day, yyyy-MM-dd. */
  key: string;
  /** Axis label: "Nov 4", for a week the day it starts on, "Nov 25". */
  label: string;
  /** Tooltip title: "Tue, Nov 4", "Week of Nov 3", "November 2026". */
  tip: string;
  sales: number;
  orders: number;
  itemsSold: number;
}

const bucketStart = (d: Date, b: Bucket) => (b === 'day' ? startOfDay(d) : b === 'week' ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d));
const bucketNext = (d: Date, b: Bucket) => (b === 'day' ? addDays(d, 1) : b === 'week' ? addWeeks(d, 1) : addMonths(d, 1));
const bucketLabels = (d: Date, b: Bucket) =>
  b === 'day' ? { label: format(d, 'MMM d'), tip: format(d, 'EEE, MMM d') }
  : b === 'week' ? { label: format(d, 'MMM d'), tip: `Week of ${format(d, 'MMM d')}` }
  : { label: format(d, 'MMM yy'), tip: format(d, 'MMMM yyyy') };

/**
 * Daily sales summed into days, weeks (Monday first) or months. Quiet buckets are kept as zeros so a gap reads as a
 * gap: between the first and last sale, widened to `range` when one is given (so the current and previous periods
 * line up bucket for bucket).
 */
export function bucketSeries(series: SalesOverTimeData[], bucket: Bucket, range?: RangeLike | null, now: Date = new Date()): BucketRow[] {
  const sums = new Map<string, { sales: number; orders: number; itemsSold: number }>();
  let first: Date | null = null, last: Date | null = null;
  for (const row of series) {
    const d = parseISO(row.date);
    if (Number.isNaN(d.getTime())) continue;
    const key = format(bucketStart(d, bucket), 'yyyy-MM-dd');
    const s = sums.get(key) ?? { sales: 0, orders: 0, itemsSold: 0 };
    s.sales += row.sales; s.orders += row.orders; s.itemsSold += row.itemsSold;
    sums.set(key, s);
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  let lo = first, hi = last;
  if (range?.from) {
    const from = startOfDay(range.from), to = startOfDay(range.to ?? now);
    if (!lo || from < lo) lo = from;
    if (!hi || to > hi) hi = to;
  }
  if (!lo || !hi) return [];
  const rows: BucketRow[] = [];
  for (let d = bucketStart(lo, bucket); d.getTime() <= hi.getTime(); d = bucketNext(d, bucket)) {
    const key = format(d, 'yyyy-MM-dd');
    rows.push({ key, ...bucketLabels(d, bucket), ...(sums.get(key) ?? { sales: 0, orders: 0, itemsSold: 0 }) });
  }
  return rows;
}

export interface ComparedRow { key: string; label: string; tip: string; value: number; orders: number; prev?: number; prevLabel?: string }

/** The current buckets with the previous period's laid beside them, first with first (same axis, one measure). */
export function compareSeries(current: BucketRow[], previous?: BucketRow[] | null): ComparedRow[] {
  return current.map((r, i) => ({
    key: r.key, label: r.label, tip: r.tip, value: r.sales, orders: r.orders,
    ...(previous && previous[i] ? { prev: previous[i].sales, prevLabel: previous[i].tip } : {}),
  }));
}

export interface CustomerFlowRow { key: string; label: string; tip: string; newCustomers: number; returningCustomers: number }

/** New and returning customers per bucket: a customer is new in the bucket of their first sale, returning after. */
export function bucketCustomerFlow(days: CustomerDay[], bucket: Bucket, range?: RangeLike | null, now: Date = new Date()): CustomerFlowRow[] {
  const empty = days.map(d => ({ date: d.date, sales: 0, orders: 0, itemsSold: 0 }));
  const frame = bucketSeries(empty, bucket, range, now);
  const news = new Map<string, Set<string>>(), all = new Map<string, Set<string>>();
  for (const d of days) {
    const key = format(bucketStart(parseISO(d.date), bucket), 'yyyy-MM-dd');
    const n = news.get(key) ?? new Set(), a = all.get(key) ?? new Set();
    d.newKeys.forEach(k => { n.add(k); a.add(k); });
    d.returningKeys.forEach(k => a.add(k));
    news.set(key, n); all.set(key, a);
  }
  return frame.map(r => {
    const n = news.get(r.key)?.size ?? 0;
    return { key: r.key, label: r.label, tip: r.tip, newCustomers: n, returningCustomers: (all.get(r.key)?.size ?? 0) - n };
  });
}

// ── Month by month ──────────────────────────────────────────────────────────

export interface MonthRow {
  /** yyyy-MM */
  key: string;
  /** "Nov 26" */
  month: string;
  revenue: number;
  /** Sales (invoices and orders). */
  sales: number;
  /** Profit before running costs (`estProfitAdj`). */
  estProfit: number;
  running: number;
  goods: number;
  drawings: number;
  /** Net profit and its margin in percent. */
  net: number;
  netMargin: number;
  cashIn: number;
  cashOut: number;
  /** Grams of the house's metal sold, in total and by karat. */
  metalGrams: number;
  metalByKarat: Record<string, number>;
  coinRevenue: number;
  coinCount: number;
}

/**
 * Calendar month by calendar month, each worked out by the same `computeBooks` as a chosen period, so a month's
 * figures are the ones the page shows when that month is picked. `months` is the last N ending this month (quiet
 * months kept), or `'all'` from the first record on. Not bound to the page's range.
 */
export function monthlySeries(input: BooksInput, months: number | 'all' = 12, opts: BooksOptions = {}): MonthRow[] {
  const p = prepare(input, opts);
  const thisMonth = startOfMonth(p.now);
  let first: Date;
  if (months === 'all') {
    const times = [...p.jewellery, ...p.coins, ...p.orders, ...p.expenses, ...p.extras].map(d => d.t).filter(t => !Number.isNaN(t));
    if (!times.length) return [];
    first = startOfMonth(new Date(Math.min(...times)));
  } else {
    first = startOfMonth(subMonths(thisMonth, Math.max(1, months) - 1));
  }
  const last = months === 'all' ? new Date(Math.max(thisMonth.getTime(), first.getTime())) : thisMonth;
  return eachMonthOfInterval({ start: first, end: last }).map(m => {
    const b = computeWith(p, { from: m, to: endOfMonth(m) });
    return {
      key: format(m, 'yyyy-MM'), month: format(m, 'MMM yy'),
      revenue: b.totalSales, sales: b.totalOrders, estProfit: b.estProfitAdj,
      running: b.runningExpenses, goods: b.goodsExpenses, drawings: b.drawingsExpenses,
      net: b.netProfit, netMargin: b.netMargin, cashIn: b.cashIn, cashOut: b.cashOut,
      metalGrams: b.metalGrams, metalByKarat: Object.fromEntries(b.metalByKarat.map(k => [k.karat, k.grams])),
      coinRevenue: b.coinSummary.revenue, coinCount: b.coinSummary.coins,
    };
  });
}

/** The karats a run of months holds, heaviest overall first (the stack's keys). */
export function karatsOf(rows: MonthRow[]): string[] {
  const total: Record<string, number> = {};
  rows.forEach(r => Object.entries(r.metalByKarat).forEach(([k, g]) => { total[k] = (total[k] || 0) + g; }));
  return Object.keys(total).sort((a, b) => total[b] - total[a]);
}

/**
 * Revenue per calendar month across the whole history, not bound to the range: the shape of the trend rather than a
 * slice. Same revenue basis as everywhere (invoice sale value on its order date, uninvoiced order subtotals, extra
 * revenue). Empty months are kept so gaps read as gaps.
 */
export function monthlyRevenue(input: BooksInput): { data: { key: string; month: string; revenue: number; sales: number }[]; average: number; best: string | null } {
  const p = prepare(input);
  const bucket: Record<string, { revenue: number; sales: number }> = {};
  const add = (iso: string, amount: number) => {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return;
    const key = format(startOfMonth(d), 'yyyy-MM');
    if (!bucket[key]) bucket[key] = { revenue: 0, sales: 0 };
    bucket[key].revenue += amount;
    bucket[key].sales += 1;
  };
  p.jewellery.forEach(({ item: inv }) => add(getInvoiceRevenueDate(inv, p.ordersById), invoiceSaleValue(inv)));
  p.orders.forEach(({ item: o }) => add(o.createdAt, o.subtotal || 0));
  p.extras.forEach(({ item: r }) => add(r.date, r.amount || 0));

  const keys = Object.keys(bucket).sort();
  if (!keys.length) return { data: [], average: 0, best: null };
  // Every month between the first and last, so a quiet month shows as a gap instead of collapsing the timeline.
  const data = eachMonthOfInterval({ start: parseISO(`${keys[0]}-01`), end: parseISO(`${keys[keys.length - 1]}-01`) }).map(m => {
    const key = format(m, 'yyyy-MM');
    const b = bucket[key];
    return { key, month: format(m, 'MMM yy'), revenue: b?.revenue || 0, sales: b?.sales || 0 };
  });
  const withRevenue = data.filter(d => d.revenue > 0);
  const average = withRevenue.length ? withRevenue.reduce((s, d) => s + d.revenue, 0) / withRevenue.length : 0;
  const best = data.reduce((m, d) => (d.revenue > (m?.revenue ?? -1) ? d : m), data[0])?.key ?? null;
  return { data, average, best };
}

export interface YearRow { year: number; revenue: number; expenses: number; unpaid: number; profit: number; netProfit: number; netMargin: number }

/** Each calendar year of the history, newest first (the old "Yearly Performance Overview"). */
export function yearlySummary(input: BooksInput): YearRow[] {
  const p = prepare(input);
  const yearMap: Record<number, { revenue: number; expenses: number; unpaid: number; profit: number; goods: number }> = {};
  const blank = () => ({ revenue: 0, expenses: 0, unpaid: 0, profit: 0, goods: 0 });
  p.jewellery.forEach(({ item: inv, t }) => {
    if (Number.isNaN(t)) return;
    const yr = getYear(t);
    if (!yearMap[yr]) yearMap[yr] = blank();
    const value = invoiceSaleValue(inv);
    yearMap[yr].revenue += value;
    // Each sale at its own margin: from the 24k rate typed when it was made, else the assumed one (lib/margin.ts).
    yearMap[yr].profit += value * invoiceMargin(inv).percent / 100;
    yearMap[yr].unpaid += Math.max(0, inv.balanceDue || 0);
  });
  p.orders.forEach(({ item: order, t }) => {
    if (Number.isNaN(t)) return;
    const yr = getYear(t);
    if (!yearMap[yr]) yearMap[yr] = blank();
    // Subtotal: the full order value regardless of advance paid.
    yearMap[yr].revenue += order.subtotal || 0;
    yearMap[yr].profit += (order.subtotal || 0) * orderMargin(order).percent / 100;
  });
  p.extras.forEach(({ item: r, t }) => {
    if (Number.isNaN(t)) return;
    const yr = getYear(t);
    if (!yearMap[yr]) yearMap[yr] = blank();
    yearMap[yr].revenue += r.amount || 0;
    yearMap[yr].profit += (r.amount || 0) * ASSUMED_MARGIN;
  });
  p.expenses.forEach(({ item: exp, t }) => {
    if (Number.isNaN(t)) return;
    // Drawings are a distribution of profit, not a cost of earning it; the goods (Mina's stock and karigars) are already
    // inside the estimated profit's margin. Where a house records its goods (Mina) they come off the revenue as the
    // gross profit (profitBeforeRunning).
    const goods = isGoodsExpense(exp);
    if (!goods && !isRunningCost(exp)) return;
    const yr = getYear(t);
    if (!yearMap[yr]) yearMap[yr] = blank();
    if (goods) yearMap[yr].goods += exp.amount || 0;
    else yearMap[yr].expenses += exp.amount || 0;
  });
  return Object.entries(yearMap)
    .map(([year, data]) => {
      const profit = profitBeforeRunning({ estimated: data.profit, revenue: data.revenue, goods: data.goods });
      // That profit less the running costs, never revenue less every expense (net-profit.ts).
      const net = netProfitOf(profit, data.expenses);
      return { year: parseInt(year), revenue: data.revenue, expenses: data.expenses, unpaid: data.unpaid, profit, netProfit: net, netMargin: netMarginPercent(net, data.revenue) };
    })
    .sort((a, b) => b.year - a.year);
}
