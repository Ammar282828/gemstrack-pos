import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_START, benchmarkSummary, monthKey, monthLabel, monthlyRows, monthsSinceStart, newOverheadId,
  overheadProgress, overheadTotal, planForMonth, revenueByMonth, type OverheadPlan,
} from './overheads';

// The sheet's arithmetic, case for case with the iPhone app's port (apps/iphone/Packages/ERPCore,
// OverheadsTests). Instants are mid-month and mid-day so the month is the same in any time zone the
// tests run in; "now" is built in local time, as the page builds it. All names and amounts made up.

const plan = (from: string, ...amounts: number[]): OverheadPlan => ({
  from, items: amounts.map((amount, i) => ({ id: `item-${i + 1}`, label: `Line ${i + 1}`, amount })),
});

describe('the sheet', () => {
  it('adds the lines, a missing or odd amount counting as nothing', () => {
    expect(overheadTotal([{ id: 'a', label: 'Rent', amount: 20_000 }, { id: 'b', label: 'Help', amount: 35_500 }])).toBe(55_500);
    expect(overheadTotal([{ id: 'a', label: 'Odd', amount: Number.NaN }, { id: 'b', label: 'Text', amount: '7000' as unknown as number }])).toBe(7000);
    expect(overheadTotal([])).toBe(0);
  });

  it('gives a new line an id no sibling has', () => {
    expect(newOverheadId([])).toBe('item-1');
    expect(newOverheadId([{ id: 'rent', label: 'Rent', amount: 1 }])).toBe('item-2');
    expect(newOverheadId([{ id: 'item-2', label: 'A', amount: 1 }, { id: 'item-3', label: 'B', amount: 1 }])).toBe('item-4');
  });

  it('names months as the page does, and leaves a key it cannot read as it is', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('2027-01')).toBe('January 2027');
    expect(monthLabel('not-a-month')).toBe('not-a-month');
    expect(monthKey(new Date(2026, 9, 10, 12))).toBe('2026-10');
  });

  it('counts the months from the start to now, and none before it', () => {
    expect(monthsSinceStart(new Date(2026, 10, 3, 12))).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(monthsSinceStart(new Date(2027, 1, 1, 12), '2026-11')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsSinceStart(new Date(2026, 7, 20, 12))).toEqual([]);
    expect(monthsSinceStart(new Date(2026, 9, 1, 12), 'soon')).toEqual([]);
  });

  it('uses the latest plan that has started, and none before the first', () => {
    const plans = [plan('2026-11', 300), plan('2026-09', 100), plan('2026-10', 200)];
    expect(planForMonth(plans, '2026-09')?.[0].amount).toBe(100);
    expect(planForMonth(plans, '2026-10')?.[0].amount).toBe(200);
    expect(planForMonth(plans, '2027-03')?.[0].amount).toBe(300);
    expect(planForMonth(plans, '2026-08')).toBeNull();
    expect(planForMonth([], '2026-10')).toBeNull();
  });
});

describe('this month', () => {
  it('says what is still to earn and what each day left has to bring', () => {
    const p = overheadProgress(310_000, 124_000, new Date(2026, 9, 10, 12));
    expect(p.shortfall).toBe(186_000);
    expect(p.percent).toBe(40);
    // 31 days in October, the 10th itself included.
    expect(p.daysLeft).toBe(22);
    expect(p.perDayNeeded).toBeCloseTo(186_000 / 22, 9);
  });

  it('once covered: nothing short, nothing a day, the bar full', () => {
    const p = overheadProgress(100_000, 150_000, new Date(2026, 1, 28, 12));
    expect(p).toEqual({ target: 100_000, earned: 150_000, shortfall: 0, percent: 100, daysLeft: 1, perDayNeeded: 0 });
  });

  it('a sheet of nothing has an empty bar', () => {
    expect(overheadProgress(0, 5000, new Date(2026, 8, 1, 12)).percent).toBe(0);
    expect(overheadProgress(0, 5000, new Date(2026, 8, 1, 12)).daysLeft).toBe(30);
  });
});

describe('revenue by month', () => {
  it('dates an invoice by its order, counts the exchange, and drops a refund', () => {
    const orders = [
      { id: 'ORD-1', createdAt: '2026-09-14T10:00:00.000Z', subtotal: 90_000, invoiceId: 'INV-1', status: 'Completed' },
    ];
    const invoices = [
      // Billed in October for an order taken in September: September's.
      { id: 'INV-1', createdAt: '2026-10-15T10:00:00.000Z', sourceOrderId: 'ORD-1', grandTotal: 60_000, exchanges: [{ description: 'Old ring', value: 30_000 }] },
      { id: 'INV-2', createdAt: '2026-10-16T10:00:00.000Z', grandTotal: 25_000 },
      { id: 'INV-3', createdAt: '2026-10-17T10:00:00.000Z', grandTotal: 40_000, status: 'Refunded' },
      { id: 'INV-4', createdAt: '', grandTotal: 99_000 },
      { id: 'INV-5', createdAt: 'whenever', grandTotal: 99_000 },
    ];
    const r = revenueByMonth(invoices as never, orders);
    expect(r['2026-09']).toEqual({ invoiced: 90_000, uninvoiced: 0, total: 90_000 });
    expect(r['2026-10']).toEqual({ invoiced: 25_000, uninvoiced: 0, total: 25_000 });
    expect(Object.keys(r).sort()).toEqual(['2026-09', '2026-10']);
  });

  it('an invoice whose order is not on file keeps its own date', () => {
    const r = revenueByMonth([{ createdAt: '2026-10-05T10:00:00.000Z', sourceOrderId: 'ORD-GONE', grandTotal: 12_000 }] as never, []);
    expect(r['2026-10'].total).toBe(12_000);
  });

  it('an order not yet billed counts at its subtotal; cancelled, refunded and billed ones do not', () => {
    const orders = [
      { id: 'ORD-2', createdAt: '2026-10-02T10:00:00.000Z', subtotal: 70_000, status: 'Pending' },
      { id: 'ORD-3', createdAt: '2026-10-03T10:00:00.000Z', subtotal: 11_000, status: 'Cancelled' },
      { id: 'ORD-4', createdAt: '2026-10-04T10:00:00.000Z', subtotal: 12_000, status: 'Refunded' },
      { id: 'ORD-5', createdAt: '2026-10-05T10:00:00.000Z', subtotal: 13_000, invoiceId: 'INV-9' },
      { id: 'ORD-6', createdAt: '2026-10-06T10:00:00.000Z', status: 'In Progress' },
      { id: 'ORD-7', subtotal: 14_000 },
    ];
    expect(revenueByMonth([], orders)['2026-10']).toEqual({ invoiced: 0, uninvoiced: 70_000, total: 70_000 });
  });
});

describe('month by month', () => {
  const now = new Date(2026, 10, 12, 12); // 12 November 2026
  const plans = [plan('2026-09', 100_000, 50_000), plan('2026-11', 200_000)];
  const revenue = { '2026-09': { total: 180_000 }, '2026-10': { total: 120_000 }, '2026-11': { total: 30_000 } };

  it('one row a month from the start, newest first, each against the plan in force then', () => {
    const rows = monthlyRows(plans, revenue, now);
    expect(rows.map(r => r.month)).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(rows[0]).toEqual({ month: '2026-11', label: 'November 2026', target: 200_000, earned: 30_000, surplus: -170_000, met: false, percent: 15, inProgress: true });
    expect(rows[1]).toEqual({ month: '2026-10', label: 'October 2026', target: 150_000, earned: 120_000, surplus: -30_000, met: false, percent: 80, inProgress: false });
    expect(rows[2]).toEqual({ month: '2026-09', label: 'September 2026', target: 150_000, earned: 180_000, surplus: 30_000, met: true, percent: 100, inProgress: false });
  });

  it('a month before any plan has no target and is never met', () => {
    const rows = monthlyRows([plan('2026-10', 1000)], { '2026-09': { total: 5000 } }, new Date(2026, 9, 2, 12));
    expect(rows[1]).toMatchObject({ month: '2026-09', target: 0, earned: 5000, met: false, percent: 0 });
  });

  it('scores only the finished months', () => {
    const s = benchmarkSummary(monthlyRows(plans, revenue, now));
    expect(s.monthsScored).toBe(2);
    expect(s.monthsMet).toBe(1);
    expect(s.averageRevenue).toBe(150_000);
    expect(s.cumulativeSurplus).toBe(0);
    expect(s.best?.month).toBe('2026-09');
    expect(s.worst?.month).toBe('2026-10');
  });

  it('with nothing finished yet, nothing is scored', () => {
    const s = benchmarkSummary(monthlyRows(plans, revenue, new Date(2026, 8, 20, 12)));
    expect(s).toEqual({ monthsScored: 0, monthsMet: 0, averageRevenue: 0, cumulativeSurplus: 0, best: null, worst: null });
  });

  it('starts in September 2026', () => {
    expect(BENCHMARK_START).toBe('2026-09');
  });
});
