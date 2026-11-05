import { describe, expect, it, vi } from 'vitest';
import type { Invoice, InvoiceItem, Order, Expense, AdditionalRevenue } from '@/lib/store';
import type * as BooksModule from './books';

// Taheri's settings (the code's defaults): no goods recorded, gold is the metal, 10% assumed margin.
const books: typeof BooksModule = await import('./books');
const { computeBooks, previousRange, previousPeriod, monthlySeries, monthlyRevenue, yearlySummary, bucketSeries, autoBucket, compareSeries, bucketCustomerFlow, karatsOf } = books;

const NOW = new Date('2026-11-05T12:00:00');
const NOV = { from: new Date('2026-11-01T00:00:00'), to: new Date('2026-11-05T00:00:00') };

const item = (o: Partial<InvoiceItem>): InvoiceItem => ({
  sku: 'X', name: 'Piece', categoryId: 'cat001', metalType: 'gold', karat: '22k', metalWeightG: 0, stoneWeightG: 0, quantity: 1,
  unitPrice: 0, itemTotal: 0, metalCost: 0, wastageCost: 0, wastagePercentage: 0, makingCharges: 0,
  diamondChargesIfAny: 0, stoneChargesIfAny: 0, miscChargesIfAny: 0, ...o,
} as InvoiceItem);

const invoice = (o: Partial<Invoice> & { id: string }): Invoice => ({
  customerName: '', items: [], subtotal: 0, discountAmount: 0, grandTotal: 0, amountPaid: 0, balanceDue: 0,
  createdAt: '2026-11-01T10:00:00', ratesApplied: {}, paymentHistory: [], status: 'Paid', ...o,
} as unknown as Invoice);

// Last month: one ring, Ayesha's first purchase, paid in full on the day.
const INV_OCT = invoice({
  id: 'INV-0', createdAt: '2026-10-03T10:00:00', customerId: 'c1', customerName: 'Ayesha',
  items: [item({ sku: 'R0', name: 'Old ring', metalWeightG: 5, itemTotal: 40000 })],
  subtotal: 40000, grandTotal: 40000, amountPaid: 40000, balanceDue: 0,
  paymentHistory: [{ id: 'p0', date: '2026-10-03T10:00:00', amount: 40000, method: 'Cash' }] as Invoice['paymentHistory'],
});
// A 22k ring of 10 g for 100,000, 60,000 paid, 40,000 owed.
const INV_1 = invoice({
  id: 'INV-1', createdAt: '2026-11-02T10:00:00', customerId: 'c1', customerName: 'Ayesha',
  items: [item({ sku: 'R1', name: 'Ring A', metalWeightG: 10, itemTotal: 100000 })],
  subtotal: 100000, grandTotal: 100000, amountPaid: 60000, balanceDue: 40000,
  paymentHistory: [{ id: 'p1', date: '2026-11-02T10:00:00', amount: 60000, method: 'Cash' }] as Invoice['paymentHistory'],
});
// One bill for a 21k ring of 5 g (50,000) and a gold coin of 8 g (200,000): 20% jewellery, 80% coin, paid in full.
const INV_2 = invoice({
  id: 'INV-2', createdAt: '2026-11-03T11:00:00', customerId: 'c2', customerName: 'Bilal',
  items: [
    item({ sku: 'R2', name: 'Ring B', karat: '21k', metalWeightG: 5, itemTotal: 50000 }),
    item({ sku: 'C1', name: 'Coin', categoryId: 'cat017', karat: '24k', metalWeightG: 8, itemTotal: 200000 }),
  ],
  subtotal: 250000, grandTotal: 250000, amountPaid: 250000, balanceDue: 0,
  paymentHistory: [{ id: 'p2', date: '2026-11-03T11:00:00', amount: 250000, method: 'Cash' }] as Invoice['paymentHistory'],
});
// An order taken on the 4th, not invoiced: 80,000 with 20,000 down.
const ORD_1 = {
  id: 'ORD-1', createdAt: '2026-11-04T09:00:00', status: 'New', items: [], subtotal: 80000, grandTotal: 60000,
  advancePayment: 20000, advanceMethod: 'Cash', customerId: 'c1', customerName: 'Ayesha', ratesApplied: {},
} as unknown as Order;
const EXTRA = { id: 'X1', date: '2026-11-04T15:00:00', description: 'Repair', amount: 10000 } as AdditionalRevenue;
const RENT = { id: 'E1', date: '2026-11-01T09:00:00', category: 'Rent', description: 'Shop rent', amount: 30000 } as Expense;
const DRAWINGS = { id: 'E2', date: '2026-11-02T09:00:00', category: 'Partner Drawings', description: 'Draw', amount: 15000 } as Expense;

const input: BooksModule.BooksInput = {
  invoices: [INV_OCT, INV_1, INV_2], orders: [ORD_1], products: [], categories: [],
  customers: [], expenses: [RENT, DRAWINGS], additionalRevenues: [EXTRA],
};

describe('computeBooks: the old component\'s figures on the fixture, worked by hand', () => {
  const b = computeBooks(input, NOV, { now: NOW });

  it('revenue: the coin is apart, the order counts at its subtotal, extra revenue is added', () => {
    // INV-1 100,000 + INV-2's jewellery 20% of 250,000 = 50,000; order 80,000; extra 10,000.
    expect(b.invoiceSales).toBe(150000);
    expect(b.orderSales).toBe(80000);
    expect(b.extraRevenue).toBe(10000);
    expect(b.totalSales).toBe(240000);
    expect(b.coinSummary).toMatchObject({ invoices: 1, coins: 1, grams: 8, revenue: 200000, outstanding: 0 });
    expect(b.hasCoins).toBe(true);
    // Two invoices and one order; the average is over those, not over extra revenue.
    expect(b.totalOrders).toBe(3);
    expect(b.averageOrderValue).toBeCloseTo(230000 / 3, 6);
    expect(b.totalItemsSold).toBe(2);
    expect(b.totalUnpaid).toBe(40000);
  });

  it('profit: 10% on everything (no 24k rate typed), net is that less the running costs only', () => {
    expect(b.estProfit).toBeCloseTo(24000, 6);
    expect(b.salesCount).toBe(3);
    expect(b.salesCosted).toBe(0);
    expect(b.estProfitAdj).toBeCloseTo(24000, 6);
    expect(b.costOfPieces).toBeCloseTo(216000, 6);
    expect(b.runningExpenses).toBe(30000);
    expect(b.drawingsExpenses).toBe(15000);
    expect(b.goodsExpenses).toBe(0);
    expect(b.totalExpenses).toBe(45000);
    expect(b.netProfit).toBeCloseTo(-6000, 6);
    expect(b.netMargin).toBeCloseTo(-2.5, 6);
    expect(b.expenseKinds).toEqual({ running: 30000, goods: 0, drawings: 15000 });
    expect(b.expensesByCategory).toEqual([
      { category: 'Rent', amount: 30000, kind: 'running' },
      { category: 'Partner Drawings', amount: 15000, kind: 'drawings' },
    ]);
  });

  it('cash: payments on the day, the order advance, extra revenue; expenses out', () => {
    // 60,000 + the jewellery 20% of 250,000 = 110,000 on invoices; 20,000 advance; 10,000 extra.
    expect(b.cashInFromInvoicePayments).toBe(110000);
    expect(b.cashInFromOrderAdvances).toBe(20000);
    expect(b.cashInFromExtraRevenue).toBe(10000);
    expect(b.cashIn).toBe(140000);
    expect(b.cashOut).toBe(45000);
    expect(b.cashOutRunning).toBe(30000);
    expect(b.cashOutDrawings).toBe(15000);
    expect(b.netCashFlow).toBe(95000);
    // Earned 240,000, collected 140,000: 40,000 on the bill and 60,000 on the order.
    expect(b.accrualVsCashGap).toBe(100000);
  });

  it('metal: the house\'s metal by karat, coins left out', () => {
    expect(b.metalGrams).toBe(15);
    expect(b.metalPieces).toBe(2);
    expect(b.metalByKarat).toEqual([{ karat: '22k', grams: 10, pieces: 1 }, { karat: '21k', grams: 5, pieces: 1 }]);
    expect(computeBooks(input, NOV, { now: NOW, metal: 'silver' }).metalGrams).toBe(0);
  });

  it('series and rankings', () => {
    expect(b.salesOverTime).toEqual([
      { date: '2026-11-02', sales: 100000, orders: 1, itemsSold: 1 },
      { date: '2026-11-03', sales: 50000, orders: 1, itemsSold: 1 },
      { date: '2026-11-04', sales: 90000, orders: 1, itemsSold: 0 },
    ]);
    expect(b.topProductsByRevenue.map(p => p.sku)).toEqual(['R1', 'R2']);
    expect(b.receivables).toEqual([expect.objectContaining({ id: 'INV-1', balanceDue: 40000, coinDue: 0 })]);
    expect(b.receivablesTotal).toBe(40000);
    expect(b.revenueMix.map(r => r.value)).toEqual([150000, 80000, 10000]);
    expect(b.largestExpenses.map(e => e.id)).toEqual(['E1', 'E2']);
    expect(b.rangeEmpty).toBe(false);
  });

  it('by weekday: the average over the weekdays the range holds', () => {
    // 1–5 Nov 2026 is Sunday to Thursday, each once; the 2nd is a Monday.
    const w = Object.fromEntries(b.byWeekday.map(r => [r.label, r]));
    expect(w.Mon).toMatchObject({ revenue: 100000, days: 1, avg: 100000, count: 1 });
    expect(w.Tue.avg).toBe(50000);
    expect(w.Wed.avg).toBe(90000);
    expect(w.Fri).toMatchObject({ days: 0, avg: 0 });
  });

  it('new vs returning: first-ever sale in the range, walk-ins left out', () => {
    // Bilal's first sale is the 3rd (new); Ayesha bought in October (returning), twice this month.
    expect(b.newCustomers).toBe(1);
    expect(b.returningCustomers).toBe(1);
    expect(b.revenueFromNew).toBe(50000);
    expect(b.revenueFromReturning).toBe(180000);
    const flow = bucketCustomerFlow(b.customerDays, 'day', NOV, NOW);
    expect(flow.find(r => r.key === '2026-11-03')).toMatchObject({ newCustomers: 1, returningCustomers: 0 });
    expect(flow.find(r => r.key === '2026-11-02')).toMatchObject({ newCustomers: 0, returningCustomers: 1 });
  });

  it('all time: everyone is new, nothing is dropped, and no range at all behaves the same', () => {
    const all = computeBooks(input, undefined, { now: NOW });
    expect(all.totalSales).toBe(280000);
    expect(all.returningCustomers).toBe(0);
    expect(computeBooks(input, { from: null, to: null }, { now: NOW }).totalSales).toBe(280000);
  });

  it('an empty range is flagged', () => {
    const none = computeBooks(input, { from: new Date('2025-01-01T00:00:00'), to: new Date('2025-01-31T00:00:00') }, { now: NOW });
    expect(none.rangeEmpty).toBe(true);
    expect(none.totalSales).toBe(0);
  });

  it('cash still shows money collected on older bills in a month with no new sale', () => {
    const quiet = computeBooks({ ...input, expenses: [], additionalRevenues: [] }, { from: new Date('2026-10-01T00:00:00'), to: new Date('2026-10-02T00:00:00') }, { now: NOW });
    expect(quiet.totalSales).toBe(0);
    const later = invoice({ ...INV_1, id: 'INV-L', paymentHistory: [{ id: 'pl', date: '2026-10-02T10:00:00', amount: 5000, method: 'Cash' }] as Invoice['paymentHistory'] });
    const collected = computeBooks({ ...input, invoices: [later], orders: [], expenses: [], additionalRevenues: [] }, { from: new Date('2026-10-01T00:00:00'), to: new Date('2026-10-02T00:00:00') }, { now: NOW });
    expect(collected.cashIn).toBe(5000);
  });
});

describe('previous period', () => {
  const d = (s: string) => new Date(`${s}T00:00:00`);
  it('is the same length immediately before', () => {
    const p = previousRange({ from: d('2026-11-08'), to: d('2026-11-14') }, NOW)!;
    expect(p.from).toEqual(d('2026-11-01'));
    expect(p.to.getTime()).toBe(new Date('2026-11-07T23:59:59.999').getTime());
    expect(previousPeriod({ from: d('2026-11-08'), to: d('2026-11-14') }, NOW)!.label).toBe('previous 7 days');
  });
  it('compares a month with the same days of the month before', () => {
    const mtd = previousPeriod({ from: d('2026-11-01'), to: d('2026-11-05') }, NOW)!;
    expect(mtd.label).toBe('last month');
    expect(mtd.range.from).toEqual(d('2026-10-01'));
    expect(mtd.range.to.getTime()).toBe(new Date('2026-10-05T23:59:59.999').getTime());
    // March has 31 days, February 28: the whole of it.
    const march = previousPeriod({ from: d('2026-03-01'), to: d('2026-03-31') }, NOW)!;
    expect(march.range.from).toEqual(d('2026-02-01'));
    expect(march.range.to.getTime()).toBe(new Date('2026-02-28T23:59:59.999').getTime());
  });
  it('compares a year with the year before', () => {
    const y = previousPeriod({ from: d('2026-01-01'), to: d('2026-11-05') }, NOW)!;
    expect(y.label).toBe('last year');
    expect(y.range.from).toEqual(d('2025-01-01'));
    expect(y.range.to.getTime()).toBe(new Date('2025-11-05T23:59:59.999').getTime());
  });
  it('is null for all time', () => {
    expect(previousRange(undefined, NOW)).toBeNull();
    expect(previousRange({ from: null, to: null }, NOW)).toBeNull();
  });
  it('last month\'s books are what the Overview compares with', () => {
    const prev = computeBooks(input, previousRange(NOV, NOW), { now: NOW });
    expect(prev.totalSales).toBe(40000);
  });
});

describe('bucketSeries', () => {
  const row = (date: string, sales: number) => ({ date, sales, orders: 1, itemsSold: 1 });
  it('weeks start on Monday', () => {
    // 2026-10-31 is a Saturday, 11-01 a Sunday, 11-02 a Monday, 11-08 a Sunday, 11-09 a Monday.
    const rows = bucketSeries([row('2026-10-31', 1), row('2026-11-01', 2), row('2026-11-02', 4), row('2026-11-08', 8), row('2026-11-09', 16)], 'week');
    expect(rows.map(r => [r.key, r.sales])).toEqual([['2026-10-26', 3], ['2026-11-02', 12], ['2026-11-09', 16]]);
    expect(rows[1].tip).toBe('Week of Nov 2');
  });
  it('keeps quiet buckets as zeros and widens to the range', () => {
    const days = bucketSeries([row('2026-11-02', 5), row('2026-11-05', 7)], 'day');
    expect(days.map(r => r.sales)).toEqual([5, 0, 0, 7]);
    const ranged = bucketSeries([row('2026-11-03', 5)], 'day', { from: new Date('2026-11-01T00:00:00'), to: new Date('2026-11-05T00:00:00') });
    expect(ranged.map(r => r.key)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  });
  it('months', () => {
    const rows = bucketSeries([row('2026-09-30', 1), row('2026-11-01', 2), row('2026-11-20', 3)], 'month');
    expect(rows.map(r => [r.key, r.sales])).toEqual([['2026-09-01', 1], ['2026-10-01', 0], ['2026-11-01', 5]]);
  });
  it('the previous period lines up bucket for bucket', () => {
    const cur = bucketSeries([row('2026-11-02', 5)], 'day', NOV);
    const prev = bucketSeries([row('2026-10-03', 3)], 'day', previousRange(NOV, NOW), NOW);
    const both = compareSeries(cur, prev);
    expect(both).toHaveLength(5);
    expect(both[0].prev).toBe(0);
    expect(both[2].prev).toBe(3);
    expect(both[2].value).toBe(0);
  });
  it('autoBucket: days up to 45, weeks up to 200, else months', () => {
    const r = (days: number) => ({ from: new Date('2026-01-01T00:00:00'), to: new Date(2026, 0, days) });
    expect(autoBucket(r(45), NOW)).toBe('day');
    expect(autoBucket(r(46), NOW)).toBe('week');
    expect(autoBucket({ from: new Date('2026-01-01T00:00:00'), to: new Date('2026-07-19T00:00:00') }, NOW)).toBe('week');
    expect(autoBucket({ from: new Date('2026-01-01T00:00:00'), to: new Date('2026-07-20T00:00:00') }, NOW)).toBe('month');
    expect(autoBucket(undefined, NOW)).toBe('month');
  });
});

describe('month by month', () => {
  it('each month is the books of that month', () => {
    const rows = monthlySeries(input, 2, { now: NOW });
    expect(rows.map(r => r.key)).toEqual(['2026-10', '2026-11']);
    const [oct, nov] = rows;
    expect(oct).toMatchObject({ revenue: 40000, estProfit: 4000, running: 0, net: 4000, cashIn: 40000, cashOut: 0, metalGrams: 5 });
    expect(nov).toMatchObject({ revenue: 240000, running: 30000, drawings: 15000, cashIn: 140000, cashOut: 45000, metalGrams: 15, coinRevenue: 200000, coinCount: 1 });
    expect(nov.net).toBeCloseTo(-6000, 6);
    expect(nov.metalByKarat).toEqual({ '22k': 10, '21k': 5 });
    expect(karatsOf(rows)).toEqual(['22k', '21k']);
  });
  it('"all" starts at the first record and keeps quiet months', () => {
    expect(monthlySeries(input, 'all', { now: NOW }).map(r => r.key)).toEqual(['2026-10', '2026-11']);
    expect(monthlySeries({ ...input, invoices: [], orders: [], expenses: [], additionalRevenues: [] }, 'all', { now: NOW })).toEqual([]);
    expect(monthlySeries(input, 3, { now: NOW }).map(r => r.key)).toEqual(['2026-09', '2026-10', '2026-11']);
  });
  it('monthlyRevenue and yearlySummary keep the old arithmetic', () => {
    const m = monthlyRevenue(input);
    expect(m.data).toEqual([
      { key: '2026-10', month: 'Oct 26', revenue: 40000, sales: 1 },
      { key: '2026-11', month: 'Nov 26', revenue: 240000, sales: 4 },
    ]);
    expect(m.average).toBe(140000);
    expect(m.best).toBe('2026-11');
    // Drawings are not a cost of earning the profit: only the 30,000 of rent comes off.
    const [y] = yearlySummary(input);
    expect(y).toMatchObject({ year: 2026, revenue: 280000, expenses: 30000, unpaid: 40000 });
    expect(y.profit).toBeCloseTo(28000, 6);
    expect(y.netProfit).toBeCloseTo(-2000, 6);
  });
});

describe('a house that records its goods (Mina) and sells silver', () => {
  it('takes profit as revenue less goods, counts silver weight', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_STORE_GOODS_EXPENSE_CATEGORIES', 'Stock & Karigars,Custom Orders');
    vi.stubEnv('NEXT_PUBLIC_STORE_DEFAULT_METAL', 'silver');
    try {
      const mina: typeof BooksModule = await import('./books');
      const silverRing = invoice({ ...INV_1, items: [item({ sku: 'S1', metalType: 'silver', karat: undefined, metalWeightG: 12, itemTotal: 100000 })] });
      const goods = { id: 'E3', date: '2026-11-02T09:00:00', category: 'Stock & Karigars', description: 'Stock', amount: 60000 } as Expense;
      const b = mina.computeBooks({ ...input, invoices: [silverRing], expenses: [RENT, goods] }, NOV, { now: NOW });
      // Revenue 100,000 + 80,000 + 10,000 = 190,000, less 60,000 of goods = 130,000; less 30,000 rent = 100,000.
      expect(b.totalSales).toBe(190000);
      expect(b.goodsExpenses).toBe(60000);
      expect(b.estProfitAdj).toBe(130000);
      expect(b.netProfit).toBe(100000);
      expect(b.expenseKinds).toEqual({ running: 30000, goods: 60000, drawings: 0 });
      expect(b.metalGrams).toBe(12);
      expect(b.metalByKarat).toEqual([{ karat: 'unknown', grams: 12, pieces: 1 }]);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
