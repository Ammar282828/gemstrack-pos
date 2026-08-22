/**
 * Revenue time-series.
 *
 * Every revenue view in the app should agree on two things: what counts as
 * revenue, and which date it lands on. Both live here so a daily, weekly and
 * monthly chart can never quietly disagree with each other or with the totals.
 *
 * What counts:
 *   • invoices (grandTotal), excluding refunded
 *   • orders not yet invoiced (subtotal — the advance is still earned)
 *   • additional revenue entries
 *
 * Which date: an invoice is recognised on its SOURCE ORDER's date, so an old
 * order invoiced late does not inflate the later period. Direct walk-in
 * invoices fall back to their own createdAt.
 */

import {
  parseISO, format, startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear,
  endOfDay, endOfWeek, endOfMonth, endOfQuarter, endOfYear,
  eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, eachQuarterOfInterval, eachYearOfInterval,
  subDays, subWeeks, subMonths, subYears, isWithinInterval, differenceInCalendarDays, getDay,
} from 'date-fns';
import type { Invoice, Order, AdditionalRevenue } from './store';
import { getInvoiceRevenueDate } from './store';

/** Monday — the shop's week runs Mon–Sun, not Sun–Sat. */
export const WEEK_STARTS_ON = 1 as const;

export type Grain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const GRAIN_LABEL: Record<Grain, string> = {
  day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly',
};

export interface RevenueEvent {
  date: Date;
  amount: number;
  kind: 'invoice' | 'order' | 'extra';
}

export interface RevenueBucket {
  key: string;
  label: string;
  revenue: number;
  count: number;
  /** Running total through this bucket — for the cumulative view. */
  cumulative: number;
  start: Date;
  end: Date;
}

export function buildRevenueEvents(
  invoices: Invoice[],
  orders: Order[],
  extras: AdditionalRevenue[],
  ordersById: Map<string, Pick<Order, 'createdAt'>>,
): RevenueEvent[] {
  const out: RevenueEvent[] = [];
  const push = (iso: string | undefined, amount: number, kind: RevenueEvent['kind']) => {
    if (!iso || !amount) return;
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return;
    out.push({ date: d, amount, kind });
  };

  for (const inv of invoices || []) {
    if (!inv?.createdAt || inv.status === 'Refunded') continue;
    push(getInvoiceRevenueDate(inv, ordersById), inv.grandTotal || 0, 'invoice');
  }
  for (const o of orders || []) {
    if (!o?.createdAt || o.status === 'Cancelled' || o.status === 'Refunded' || o.invoiceId) continue;
    push(o.createdAt, o.subtotal || 0, 'order');
  }
  for (const r of extras || []) {
    push(r?.date, r?.amount || 0, 'extra');
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

const GRAIN: Record<Grain, {
  start: (d: Date) => Date;
  end: (d: Date) => Date;
  each: (i: { start: Date; end: Date }) => Date[];
  key: string;
  label: string;
  sub: (d: Date, n: number) => Date;
}> = {
  day: {
    start: startOfDay, end: endOfDay,
    each: i => eachDayOfInterval(i), key: 'yyyy-MM-dd', label: 'dd MMM', sub: subDays,
  },
  week: {
    start: d => startOfWeek(d, { weekStartsOn: WEEK_STARTS_ON }),
    end: d => endOfWeek(d, { weekStartsOn: WEEK_STARTS_ON }),
    each: i => eachWeekOfInterval(i, { weekStartsOn: WEEK_STARTS_ON }),
    key: "yyyy-'W'II", label: 'dd MMM', sub: subWeeks,
  },
  month: {
    start: startOfMonth, end: endOfMonth,
    each: i => eachMonthOfInterval(i), key: 'yyyy-MM', label: 'MMM yy', sub: subMonths,
  },
  quarter: {
    start: startOfQuarter, end: endOfQuarter,
    each: i => eachQuarterOfInterval(i), key: 'yyyy-QQQ', label: 'QQQ yy', sub: (d, n) => subMonths(d, n * 3),
  },
  year: {
    start: startOfYear, end: endOfYear,
    each: i => eachYearOfInterval(i), key: 'yyyy', label: 'yyyy', sub: subYears,
  },
};

/**
 * Bucket events at the given grain. Empty periods between the first and last
 * event are kept, so a quiet week reads as a trough rather than vanishing and
 * making the trend look smoother than it was.
 */
export function bucketRevenue(
  events: RevenueEvent[],
  grain: Grain,
  opts: { from?: Date; to?: Date; maxBuckets?: number } = {},
): RevenueBucket[] {
  if (!events.length) return [];
  const g = GRAIN[grain];

  const from = opts.from ?? events[0].date;
  const to = opts.to ?? events[events.length - 1].date;
  if (from > to) return [];

  const agg = new Map<string, { revenue: number; count: number }>();
  for (const e of events) {
    if (e.date < g.start(from) || e.date > g.end(to)) continue;
    const k = format(g.start(e.date), g.key);
    const cur = agg.get(k) || { revenue: 0, count: 0 };
    cur.revenue += e.amount;
    cur.count += 1;
    agg.set(k, cur);
  }

  let periods = g.each({ start: g.start(from), end: g.end(to) });
  // A daily view over two years is unreadable and slow; keep the tail.
  if (opts.maxBuckets && periods.length > opts.maxBuckets) {
    periods = periods.slice(periods.length - opts.maxBuckets);
  }

  let running = 0;
  return periods.map(p => {
    const k = format(p, g.key);
    const hit = agg.get(k);
    running += hit?.revenue || 0;
    return {
      key: k,
      label: format(p, g.label),
      revenue: hit?.revenue || 0,
      count: hit?.count || 0,
      cumulative: running,
      start: g.start(p),
      end: g.end(p),
    };
  });
}

export interface PeriodComparison {
  grain: Grain;
  label: string;
  current: number;
  previous: number;
  count: number;
  /** Fractional change vs the previous period; null when there is no base. */
  change: number | null;
  /** Same slice of the previous period, for a fair like-for-like on a period still running. */
  previousToDate: number;
  changeToDate: number | null;
}

function sumBetween(events: RevenueEvent[], start: Date, end: Date) {
  let total = 0, count = 0;
  for (const e of events) {
    if (isWithinInterval(e.date, { start, end })) { total += e.amount; count += 1; }
  }
  return { total, count };
}

/**
 * Current vs previous period at each grain.
 *
 * `previousToDate` compares only the elapsed portion of the previous period —
 * comparing a half-finished month against a whole one always reads as a
 * collapse, which is the most common way a revenue dashboard misleads.
 */
export function comparePeriods(events: RevenueEvent[], now: Date = new Date()): PeriodComparison[] {
  const grains: { grain: Grain; label: string }[] = [
    { grain: 'day', label: 'Today' },
    { grain: 'week', label: 'This week' },
    { grain: 'month', label: 'This month' },
    { grain: 'year', label: 'This year' },
  ];

  return grains.map(({ grain, label }) => {
    const g = GRAIN[grain];
    const start = g.start(now);
    const end = g.end(now);
    const prevStart = g.start(g.sub(now, 1));
    const prevEnd = g.end(g.sub(now, 1));

    const cur = sumBetween(events, start, end);
    const prev = sumBetween(events, prevStart, prevEnd);

    // How far into the period we are, mapped onto the previous one.
    const elapsedDays = differenceInCalendarDays(now, start);
    const prevToDateEnd = endOfDay(subDays(
      new Date(prevStart.getTime() + (elapsedDays + 1) * 86400000), 1,
    ));
    const prevToDate = sumBetween(events, prevStart, prevToDateEnd > prevEnd ? prevEnd : prevToDateEnd);

    return {
      grain,
      label,
      current: cur.total,
      count: cur.count,
      previous: prev.total,
      change: prev.total > 0 ? (cur.total - prev.total) / prev.total : null,
      previousToDate: prevToDate.total,
      changeToDate: prevToDate.total > 0 ? (cur.total - prevToDate.total) / prevToDate.total : null,
    };
  });
}

/** Where the current month lands if the rest of it matches the pace so far. */
export function monthPace(events: RevenueEvent[], now: Date = new Date()) {
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  const { total } = sumBetween(events, start, endOfDay(now));
  const elapsed = differenceInCalendarDays(now, start) + 1;
  const total_days = differenceInCalendarDays(end, start) + 1;
  return {
    soFar: total,
    elapsed,
    totalDays: total_days,
    perDay: elapsed > 0 ? total / elapsed : 0,
    projected: elapsed > 0 ? (total / elapsed) * total_days : 0,
  };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Average revenue per weekday. Averaged over how many of each weekday actually
 * occurred in the range, so a month with five Mondays doesn't make Monday look
 * like the best trading day.
 */
export function revenueByWeekday(events: RevenueEvent[]) {
  if (!events.length) return [];
  const totals = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (const e of events) totals[getDay(e.date)] += e.amount;

  const first = startOfDay(events[0].date);
  const last = startOfDay(events[events.length - 1].date);
  for (const d of eachDayOfInterval({ start: first, end: last })) counts[getDay(d)] += 1;

  // Re-ordered to start on Monday, matching WEEK_STARTS_ON.
  return [1, 2, 3, 4, 5, 6, 0].map(i => ({
    day: DAY_NAMES[i].slice(0, 3),
    fullDay: DAY_NAMES[i],
    total: totals[i],
    average: counts[i] > 0 ? totals[i] / counts[i] : 0,
  }));
}
