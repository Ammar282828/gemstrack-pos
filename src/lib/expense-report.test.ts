import { describe, expect, it } from 'vitest';
import {
  customRangeOf, expenseFilterLine, expenseFiltersFrom, expenseReport, expensesTotal, filterExpenses, groupExpenses, karachiWall,
} from './expense-report';
import { drawExpenseReportPdf, expenseReportFileName } from './expense-report-pdf';
import type { Expense } from '@/lib/store';

// Made up. Days on the device's own clock, as the browser reads them.
const local = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString();
const ex = (id: string, date: string, amount: number, over: Partial<Expense> = {}): Expense =>
  ({ id, date, amount, category: 'Rent', description: `Test ${id}`, ...over }) as Expense;

const book: Expense[] = [
  ex('E1', local(2026, 10, 3), 1_000, { category: 'Rent' }),
  ex('E2', local(2026, 10, 3, 15), 500, { category: 'Tea', description: 'Chai for the bench' }),
  ex('E3', local(2026, 10, 9), 2_500, { category: 'Karigar', karigarId: 'K1', description: 'Weekly' }),
  ex('E4', local(2026, 9, 28), 4_000, { category: 'Rent' }),
];
const names = (id: string) => (id === 'K1' ? 'Test Karigar' : '');

describe('filterExpenses', () => {
  const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31, 23, 59, 59) };

  it('the period, newest first', () => {
    const rows = filterExpenses(book, { range, category: 'All', search: '', karigarName: names });
    expect(rows.map((e) => e.id)).toEqual(['E3', 'E2', 'E1']);
  });

  it('no bound is every expense', () => {
    expect(filterExpenses(book, { range: null, category: 'All', search: '', karigarName: names })).toHaveLength(4);
  });

  it('the category', () => {
    const rows = filterExpenses(book, { range: null, category: 'Rent', search: '', karigarName: names });
    expect(rows.map((e) => e.id)).toEqual(['E1', 'E4']);
  });

  it('the search: description, category, or the karigar paid, any case', () => {
    const q = (search: string) => filterExpenses(book, { range: null, category: 'All', search, karigarName: names }).map((e) => e.id);
    expect(q('chai')).toEqual(['E2']);
    expect(q('TEA')).toEqual(['E2']);
    expect(q('test karigar')).toEqual(['E3']);
    expect(q('  weekly ')).toEqual(['E3']);
    expect(q('nobody')).toEqual([]);
  });
});

describe('groupExpenses', () => {
  const now = new Date(2026, 9, 10, 12);
  const rows = filterExpenses(book, { range: null, category: 'All', search: '', karigarName: names });

  it('by day, each with its subtotal, in the rows order', () => {
    const g = groupExpenses(rows, 'day', now);
    expect(g.map((x) => [x.label, x.total, x.rows.length])).toEqual([
      ['Yesterday', 2_500, 1],
      ['Saturday 3 Oct', 1_500, 2],
      ['Monday 28 Sep', 4_000, 1],
    ]);
    expect(g[0].sub).toBe('9 Oct 2026');
  });

  it('by week (from Monday) and by month', () => {
    expect(groupExpenses(rows, 'week', now).map((x) => [x.label, x.total])).toEqual([
      ['Week of 5 Oct', 2_500],
      ['Week of 28 Sep', 5_500],
    ]);
    expect(groupExpenses(rows, 'month', now).map((x) => [x.label, x.sub, x.total])).toEqual([
      ['October 2026', 'This month', 4_000],
      ['September 2026', '', 4_000],
    ]);
  });

  it('the subtotals add up to the total', () => {
    const g = groupExpenses(rows, 'week', now);
    expect(g.reduce((s, x) => s + x.total, 0)).toBe(expensesTotal(rows));
    expect(expensesTotal(rows)).toBe(8_000);
  });
});

describe('expenseFiltersFrom', () => {
  it('reads the request, odd values as the page opens', () => {
    expect(expenseFiltersFrom({})).toEqual({ period: 'this-month', start: undefined, end: undefined, grouping: 'day', category: 'All', search: '' });
    expect(expenseFiltersFrom({ period: 'custom', start: '2026-10-01', end: 'soon', grouping: 'week', category: ' Rent ', search: 'x' }))
      .toEqual({ period: 'custom', start: '2026-10-01', end: undefined, grouping: 'week', category: 'Rent', search: 'x' });
    expect(expenseFiltersFrom({ period: 'forever', grouping: 'year', category: 7 })).toMatchObject({ period: 'this-month', grouping: 'day', category: 'All' });
  });

  it('a custom range without a start has no bound', () => {
    expect(customRangeOf({})).toBeUndefined();
    const r = customRangeOf({ start: '2026-10-01', end: '2026-10-05' })!;
    expect([r.from!.getDate(), r.to!.getDate()]).toEqual([1, 5]);
  });
});

describe('expenseFilterLine', () => {
  it("the page's words", () => {
    expect(expenseFilterLine({ period: 'all', grouping: 'month', category: 'All', search: '' }, null))
      .toBe('Period: All time | Grouped by: month | Category: All | Search: None');
    expect(expenseFilterLine({ period: 'custom', grouping: 'day', category: 'Rent', search: 'shop' }, { start: new Date(2026, 9, 1), end: new Date(2026, 9, 5) }))
      .toBe('Period: Custom range (Oct 1, 2026 – Oct 5, 2026) | Grouped by: day | Category: Rent | Search: shop');
  });
});

describe('expenseReport on Karachi’s calendar (the server’s)', () => {
  // 01:30 on 1 Oct in the shop is still 30 Sep in UTC.
  const late = ex('K1', '2026-09-30T20:30:00.000Z', 700);
  const sept = ex('K2', '2026-09-30T18:00:00.000Z', 300); // 23:00 on 30 Sep in the shop
  const now = new Date('2026-10-17T07:00:00.000Z');

  it("this month starts at the shop's midnight, and the day is the shop's", () => {
    const r = expenseReport([late, sept], expenseFiltersFrom({ period: 'this-month' }), { karigarName: names, now, wall: karachiWall });
    expect(r.rows.map((e) => e.id)).toEqual(['K1']);
    expect(r.groups.map((g) => g.label)).toEqual(['Thursday 1 Oct']);
    expect(r.total).toBe(700);
    expect(r.filterLine).toContain('Period: This month (Oct 1, 2026 – Oct 17, 2026)');
  });

  it('a custom range is whole shop days', () => {
    const r = expenseReport([late, sept], expenseFiltersFrom({ period: 'custom', start: '2026-09-30', end: '2026-09-30' }), { karigarName: names, now, wall: karachiWall });
    expect(r.rows.map((e) => e.id)).toEqual(['K2']);
  });

  it('draws the report, its file named for the day', () => {
    const r = expenseReport([late, sept], expenseFiltersFrom({ period: 'all', grouping: 'month' }), { karigarName: names, now, wall: karachiWall });
    const doc = drawExpenseReportPdf({ groups: r.groups, total: r.total, filterLine: r.filterLine, asOf: r.now, wall: karachiWall });
    const t = new TextDecoder('latin1').decode(doc.output('arraybuffer'));
    expect(t).toContain('Expense Report');
    expect(t).toContain('01-Oct-2026');
    expect(t).toContain('30-Sep-2026');
    expect(t).toContain('Total Expenses: PKR 1,000');
    expect(expenseReportFileName(r.now)).toBe('Expense-Report-2026-10-17.pdf');
  });
});
