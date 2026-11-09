import { describe, expect, it } from 'vitest';
import { goldRevenueLabel, revenueSplit, silverGoldRows } from './gold-split';
import { salesNote } from '@/lib/notifications/report-docs';

const fmt = (n: number) => `PKR ${n}`;

describe('revenue split by metal (House of Mina)', () => {
  it('labels gold with its estimated margin', () => {
    expect(goldRevenueLabel(10)).toBe('Gold revenue (est. 10% margin)');
  });

  it('is null where gold is not apart (Taheri)', () => {
    expect(revenueSplit({ totalSales: 100 }, fmt, false)).toBeNull();
  });

  it('gives silver, gold, and the caption of gold\'s estimated profit', () => {
    const s = revenueSplit({ totalSales: 100_000, goldRevenue: 40_000, silverRevenue: 60_000, goldProfit: 4_000 }, fmt, true, 10)!;
    expect(s.silver).toBe(60_000);
    expect(s.gold).toBe(40_000);
    expect(s.goldCaption).toBe('Profit est. at 10%: PKR 4000');
    expect(s.line).toBe('Silver PKR 60000 · Gold PKR 40000 (est. 10% margin)');
  });

  it('stacks silver and gold per day, silver being the rest of each bucket', () => {
    const rows = silverGoldRows([
      { date: '2026-11-02', sales: 1000, orders: 1, itemsSold: 1, gold: 400 },
      { date: '2026-11-03', sales: 500, orders: 1, itemsSold: 1 },
    ], 'day', { from: new Date('2026-11-02T00:00:00'), to: new Date('2026-11-03T00:00:00') });
    expect(rows.map(r => [r.silver, r.gold])).toEqual([[600, 400], [500, 0]]);
  });
});

describe('daily report Sales note', () => {
  it('is the invoice count alone where gold is not apart, else the metals too', () => {
    expect(salesNote({ count: 2, value: 1000, gold: 400 }, fmt, false)).toBe('2 invoices');
    expect(salesNote({ count: 1, value: 1000, gold: 400 }, fmt, true, 10)).toBe('1 invoice · silver PKR 600 · gold PKR 400 (est. 10% margin)');
  });
});
