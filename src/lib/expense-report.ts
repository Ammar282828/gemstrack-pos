/**
 * Which expenses the Expenses page shows, how it buckets them, and what its report prints.
 *
 * Here, not in the page, because the server prints the same report for the iPhone app
 * (/api/app/pdf/expenses): one filter and one grouping, or the phone's PDF and the page's would
 * drift apart by a row. The drawing itself is expense-report-pdf.ts.
 *
 * Days are read on a wall clock (wall-clock.ts): the browser's own, or Karachi's on the server.
 */

import { format, isWithinInterval, parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { bucketOf, GRADUATIONS, PERIODS, periodRange, type Graduation, type PeriodId } from '@/lib/date-grouping';
import type { Expense } from '@/lib/store';
import { deviceWall, type WallClock } from '@/lib/wall-clock';

export { deviceWall, karachiWall, type WallClock } from '@/lib/wall-clock';

/** What the page's filters stand at: the period, a custom range's days, the grouping, the category, the search. */
export interface ExpenseFilters {
  period: PeriodId;
  /** Custom range, yyyy-MM-dd; without a start the range has no bound (periodRange). */
  start?: string;
  end?: string;
  grouping: Graduation;
  /** 'All' is every category. */
  category: string;
  search: string;
}

export interface ExpenseGroup {
  key: string;
  label: string;
  sub: string;
  total: number;
  rows: Expense[];
}

/**
 * The filters as a request carries them, each odd value its default (this month, by day, every
 * category), as the page opens.
 */
export function expenseFiltersFrom(raw: Record<string, unknown>): ExpenseFilters {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : undefined);
  const period = PERIODS.find((p) => p.id === str(raw.period))?.id ?? 'this-month';
  const grouping = GRADUATIONS.find((g) => g.id === str(raw.grouping))?.id ?? 'day';
  return {
    period,
    start: day(raw.start),
    end: day(raw.end),
    grouping,
    category: str(raw.category).trim() || 'All',
    search: str(raw.search),
  };
}

/** A custom range's days as the page's range picker holds them: local midnight on the wall clock. */
export function customRangeOf(f: Pick<ExpenseFilters, 'start' | 'end'>): DateRange | undefined {
  if (!f.start) return undefined;
  return { from: parseISO(f.start), to: f.end ? parseISO(f.end) : undefined };
}

/**
 * The page's list: the category, the period, then the search over description, category and the
 * karigar paid; newest first.
 */
export function filterExpenses(
  expenses: Expense[],
  opts: {
    range: { start: Date; end: Date } | null;
    category: string;
    search: string;
    karigarName: (karigarId: string) => string;
  },
  wall: WallClock = deviceWall,
): Expense[] {
  const needle = opts.search.trim().toLowerCase();
  return expenses
    .filter((e) => {
      if (opts.category !== 'All' && e.category !== opts.category) return false;
      if (opts.range) {
        const d = wall(parseISO(e.date));
        if (!isWithinInterval(d, { start: opts.range.start, end: opts.range.end })) return false;
      }
      if (!needle) return true;
      const k = e.karigarId ? opts.karigarName(e.karigarId) || '' : '';
      return (e.description || '').toLowerCase().includes(needle)
        || (e.category || '').toLowerCase().includes(needle)
        || k.toLowerCase().includes(needle);
    })
    .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
}

/** Rows bucketed by the chosen graduation, each with its own subtotal, in the rows' order. */
export function groupExpenses(rows: Expense[], by: Graduation, now: Date = new Date(), wall: WallClock = deviceWall): ExpenseGroup[] {
  const out: ExpenseGroup[] = [];
  const index = new Map<string, number>();
  for (const e of rows) {
    const b = bucketOf(wall(parseISO(e.date)), by, now);
    let i = index.get(b.key);
    if (i === undefined) {
      i = out.length;
      index.set(b.key, i);
      out.push({ ...b, total: 0, rows: [] });
    }
    out[i].total += e.amount;
    out[i].rows.push(e);
  }
  return out;
}

export const expensesTotal = (rows: Expense[]): number => rows.reduce((s, e) => s + e.amount, 0);

/** The report's "Filters:" line: what was on screen when it was asked for. */
export function expenseFilterLine(f: Pick<ExpenseFilters, 'period' | 'grouping' | 'category' | 'search'>, range: { start: Date; end: Date } | null): string {
  const periodLabel = PERIODS.find((p) => p.id === f.period)?.label ?? '';
  return [
    `Period: ${periodLabel}${range ? ` (${format(range.start, 'PP')} – ${format(range.end, 'PP')})` : ''}`,
    `Grouped by: ${f.grouping}`,
    `Category: ${f.category}`,
    `Search: ${f.search || 'None'}`,
  ].join(' | ');
}

/** Everything the report prints, from the expenses on file and the filters, on a wall clock. */
export function expenseReport(
  expenses: Expense[],
  f: ExpenseFilters,
  opts: { karigarName: (id: string) => string; now?: Date; wall?: WallClock },
): { range: { start: Date; end: Date } | null; rows: Expense[]; groups: ExpenseGroup[]; total: number; filterLine: string; now: Date } {
  const wall = opts.wall ?? deviceWall;
  const now = wall(opts.now ?? new Date());
  const range = periodRange(f.period, customRangeOf(f), now);
  const rows = filterExpenses(expenses, { range, category: f.category, search: f.search, karigarName: opts.karigarName }, wall);
  const groups = groupExpenses(rows, f.grouping, now, wall);
  return { range, rows, groups, total: expensesTotal(rows), filterLine: expenseFilterLine(f, range), now };
}
