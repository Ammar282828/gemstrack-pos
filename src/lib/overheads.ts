/**
 * The monthly overhead benchmark.
 *
 * What the shop has to cover every month before anything is profit: salaries,
 * ad spend, rent, utilities. It answers one question — how much do we have to
 * sell this month to stand still — and then keeps score month by month.
 *
 * Deliberately NOT expenses. Nothing here is written to the expenses
 * collection, counted in profit, or reflected in the hisaab. The real payments
 * are recorded separately as they happen; this is the target they are measured
 * against. Keeping the two apart is the whole point: if the benchmark were also
 * an expense, every month would be double-counted.
 */

import {
  startOfMonth, endOfMonth, isWithinInterval, parseISO, format, addMonths, isValid,
} from 'date-fns';

export interface OverheadItem {
  /** Stable across edits so a row can be changed without being replaced. */
  id: string;
  label: string;
  /** PKR per month. */
  amount: number;
}

/**
 * A version of the sheet, in force from `from` until the next one starts.
 *
 * Versioned rather than a single editable list because the sheet is also a
 * record. Hire someone in November and a single list would silently rewrite
 * September and October's targets too, so months the shop actually cleared
 * would start showing as missed.
 */
export interface OverheadPlan {
  /** 'YYYY-MM'. */
  from: string;
  items: OverheadItem[];
}

/** The benchmark starts here. Earlier months are not scored against it. */
export const BENCHMARK_START = '2026-09';

export const DEFAULT_OVERHEADS: OverheadItem[] = [
  { id: 'new-hire',   label: 'New hire',            amount: 60_000 },
  { id: 'marketing',  label: 'Marketing',           amount: 40_000 },
  { id: 'ali',        label: 'Ali Kurshid',         amount: 85_000 },
  { id: 'models',     label: 'Models',              amount: 15_000 },
  { id: 'ads',        label: 'Ad spend',            amount: 50_000 },
  { id: 'utilities',  label: 'Utilities',           amount: 15_000 },
  { id: 'rent',       label: 'Rent',                amount: 20_000 },
  { id: 'misc',       label: 'Misc daily expenses', amount: 20_000 },
];

export const overheadTotal = (items: OverheadItem[]): number =>
  items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

/** An id that will not collide with the seeded ones or with a sibling row. */
export const newOverheadId = (existing: OverheadItem[]): string => {
  let n = existing.length + 1;
  const taken = new Set(existing.map(i => i.id));
  while (taken.has(`item-${n}`)) n += 1;
  return `item-${n}`;
};

export const monthKey = (d: Date): string => format(d, 'yyyy-MM');
export const monthLabel = (key: string): string => {
  const d = parseISO(`${key}-01`);
  return isValid(d) ? format(d, 'MMMM yyyy') : key;
};

/** Every month from the benchmark's start up to and including `now`. */
export function monthsSinceStart(now: Date, start = BENCHMARK_START): string[] {
  const first = parseISO(`${start}-01`);
  if (!isValid(first)) return [];
  const out: string[] = [];
  for (let d = startOfMonth(first); monthKey(d) <= monthKey(now); d = addMonths(d, 1)) {
    out.push(monthKey(d));
    if (out.length > 600) break; // a bad start date must not spin forever
  }
  return out;
}

/**
 * The sheet in force for a given month: the latest plan starting on or before
 * it. Months before the first plan have no benchmark and are not scored.
 */
export function planForMonth(plans: OverheadPlan[], month: string): OverheadItem[] | null {
  const applicable = plans
    .filter(p => p.from <= month)
    .sort((a, b) => a.from.localeCompare(b.from));
  return applicable.length ? applicable[applicable.length - 1].items : null;
}

export interface OverheadProgress {
  target: number;
  earned: number;
  /** 0 once the target is passed. */
  shortfall: number;
  /** 0–100, clamped, for a bar. */
  percent: number;
  /** Days left in the month, today included. Only meaningful for the current one. */
  daysLeft: number;
  /** What the remaining days have to average. 0 once covered. */
  perDayNeeded: number;
}

/**
 * `now` is injected rather than read from the clock so this is testable and so
 * a whole screen agrees on one instant.
 */
export function overheadProgress(target: number, earned: number, now: Date): OverheadProgress {
  const shortfall = Math.max(0, target - earned);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
  return {
    target,
    earned,
    shortfall,
    percent: target > 0 ? Math.min(100, Math.max(0, (earned / target) * 100)) : 0,
    daysLeft,
    perDayNeeded: shortfall > 0 ? shortfall / daysLeft : 0,
  };
}

// ── revenue ─────────────────────────────────────────────────────────────────

type InvoiceLike = {
  createdAt?: string;
  sourceOrderId?: string;
  grandTotal?: number;
  status?: string;
};
type OrderLike = {
  id: string;
  createdAt?: string;
  subtotal?: number;
  status?: string;
  invoiceId?: string;
};

/**
 * Revenue per month, by the rule Analytics uses.
 *
 * Both halves count. Invoices alone left out every order taken but not yet
 * billed — in August that was 18 orders against 44 invoices, so a page counting
 * only invoices showed barely half the month. An invoice is dated to the day
 * its ORDER was taken rather than the day it was finally billed, so a sale does
 * not drift across a month boundary when it happens to be invoiced late; an
 * uninvoiced order counts at subtotal, and drops out once it has an invoice so
 * nothing is counted twice.
 */
export function revenueByMonth(
  invoices: InvoiceLike[],
  orders: OrderLike[],
): Record<string, { invoiced: number; uninvoiced: number; total: number }> {
  const byId = new Map(orders.map(o => [o.id, o]));
  const out: Record<string, { invoiced: number; uninvoiced: number; total: number }> = {};
  const bucket = (k: string) => (out[k] ??= { invoiced: 0, uninvoiced: 0, total: 0 });

  for (const inv of invoices || []) {
    if (!inv?.createdAt || inv.status === 'Refunded') continue;
    const dated = (inv.sourceOrderId && byId.get(inv.sourceOrderId)?.createdAt) || inv.createdAt;
    const d = parseISO(dated);
    if (!isValid(d)) continue;
    const b = bucket(monthKey(d));
    b.invoiced += inv.grandTotal || 0;
    b.total += inv.grandTotal || 0;
  }

  for (const o of orders || []) {
    if (!o?.createdAt) continue;
    if (o.status === 'Cancelled' || o.status === 'Refunded' || o.invoiceId) continue;
    const d = parseISO(o.createdAt);
    if (!isValid(d)) continue;
    const b = bucket(monthKey(d));
    b.uninvoiced += o.subtotal || 0;
    b.total += o.subtotal || 0;
  }

  return out;
}

export interface MonthRow {
  month: string;
  label: string;
  target: number;
  earned: number;
  /** Positive when the month cleared its benchmark. */
  surplus: number;
  met: boolean;
  percent: number;
  /** True for the month still being lived — it has not finished yet. */
  inProgress: boolean;
}

/** One row per month from the benchmark's start to now, newest first. */
export function monthlyRows(
  plans: OverheadPlan[],
  revenue: Record<string, { total: number }>,
  now: Date,
  start = BENCHMARK_START,
): MonthRow[] {
  const current = monthKey(now);
  return monthsSinceStart(now, start)
    .map(month => {
      const items = planForMonth(plans, month);
      const target = items ? overheadTotal(items) : 0;
      const earned = revenue[month]?.total || 0;
      return {
        month,
        label: monthLabel(month),
        target,
        earned,
        surplus: earned - target,
        met: target > 0 && earned >= target,
        percent: target > 0 ? Math.min(100, Math.max(0, (earned / target) * 100)) : 0,
        inProgress: month === current,
      };
    })
    .reverse();
}

/** Totals across the finished months, so an in-progress month cannot flatter them. */
export function benchmarkSummary(rows: MonthRow[]) {
  const done = rows.filter(r => !r.inProgress && r.target > 0);
  const met = done.filter(r => r.met).length;
  const best = done.reduce<MonthRow | null>((m, r) => (!m || r.surplus > m.surplus ? r : m), null);
  const worst = done.reduce<MonthRow | null>((m, r) => (!m || r.surplus < m.surplus ? r : m), null);
  return {
    monthsScored: done.length,
    monthsMet: met,
    averageRevenue: done.length ? done.reduce((s, r) => s + r.earned, 0) / done.length : 0,
    /** Cumulative, so a bad month and a good one net out the way cash does. */
    cumulativeSurplus: done.reduce((s, r) => s + r.surplus, 0),
    best,
    worst,
  };
}

/** Used only for the current month's date arithmetic. */
export { startOfMonth, endOfMonth, isWithinInterval };
