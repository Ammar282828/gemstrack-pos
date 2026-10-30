import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Expense, Invoice, Order } from '@/lib/store';
import { ASSUMED_MARGIN } from '@/lib/margin';
import { buildMonthlyReport } from './monthly';
import { buildInsights, changeOf } from './monthly-insights';
import { niceScale } from './monthly-charts';
import { sampleShop } from './monthly-fixture';
import { buildMonthlyPdf as drawPdf } from './monthly-pdf';

const item = (over: Partial<Invoice['items'][number]> = {}) => ({
  sku: 'R1', name: 'Ring', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 5, stoneWeightG: 0, quantity: 1,
  unitPrice: 100_000, itemTotal: 100_000, ...over,
}) as Invoice['items'][number];
const inv = (over: Partial<Invoice>): Invoice => ({
  id: 'INV-1', customerName: 'Sakina', items: [item()], subtotal: 100_000, discountAmount: 0, grandTotal: 100_000,
  amountPaid: 100_000, balanceDue: 0, createdAt: '2026-09-10T08:00:00.000Z', ratesApplied: {}, paymentHistory: [], ...over,
}) as Invoice;
const order = (over: Partial<Order>): Order => ({
  id: 'ORD-1', createdAt: '2026-09-05T08:00:00.000Z', status: 'In Progress', items: [], subtotal: 200_000, advancePayment: 50_000,
  grandTotal: 200_000, customerName: 'Batool', ...over,
}) as Order;

const sep = { year: 2026, month: 9 };
const after = new Date('2026-10-05T04:00:00Z');
const run = (p: { invoices?: Invoice[]; orders?: Order[]; expenses?: Expense[] }, at = after, m = sep) =>
  buildInsights({ invoices: p.invoices ?? [], orders: p.orders ?? [], expenses: p.expenses ?? [], extraRevenues: [] }, m, at);
const fig = (i: ReturnType<typeof run>, k: string) => i.headline.find(h => h.key === k)!;

describe('changes', () => {
  it('is the percent against what was there, null against nothing', () => {
    expect(changeOf(125, 100).pct).toBe(25);
    expect(changeOf(50, 100).pct).toBe(-50);
    expect(changeOf(-50, -100).pct).toBe(50);
    expect(changeOf(10, 0).pct).toBeNull();
  });
  it('sets a finished month against last month and the same month last year', () => {
    const i = run({ invoices: [
      inv({ id: 'A' }),
      inv({ id: 'B', createdAt: '2026-08-10T08:00:00.000Z', subtotal: 80_000, grandTotal: 80_000, items: [item({ itemTotal: 80_000 })] }),
      inv({ id: 'C', createdAt: '2025-09-10T08:00:00.000Z', subtotal: 50_000, grandTotal: 50_000, items: [item({ itemTotal: 50_000 })] }),
    ] });
    expect(fig(i, 'revenue')).toMatchObject({ now: 100_000, vsLast: { before: 80_000, pct: 25 }, vsYear: { before: 50_000, pct: 100 } });
    expect(i.against).toEqual({ last: 'August', year: 'September 2025', throughDay: null });
  });
  it('sets a month still running against the same days, never a whole month', () => {
    const i = run({ invoices: [
      inv({ id: 'A', createdAt: '2026-10-03T08:00:00.000Z' }),
      inv({ id: 'B', createdAt: '2026-09-03T08:00:00.000Z', subtotal: 50_000, grandTotal: 50_000, items: [item({ itemTotal: 50_000 })] }),
      inv({ id: 'C', createdAt: '2026-09-20T08:00:00.000Z', subtotal: 500_000, grandTotal: 500_000, items: [item({ itemTotal: 500_000 })] }),
    ] }, new Date('2026-10-05T08:00:00Z'), { year: 2026, month: 10 });
    expect(fig(i, 'revenue').vsLast).toMatchObject({ now: 100_000, before: 50_000, pct: 100 });
    expect(i.against.throughDay).toBe(5);
  });
});

describe('profit, as Analytics has it', () => {
  it('is each sale at its own margin, and net profit is that less expenses, never revenue less expenses', () => {
    const i = run({
      invoices: [inv({})],
      expenses: [{ id: 'e', date: '2026-09-03', category: 'Rent', description: '', amount: 4_000 } as Expense,
        { id: 'd', date: '2026-09-04', category: 'Partner Drawings', description: '', amount: 90_000 } as Expense],
    });
    const profit = fig(i, 'profit').now;
    expect(profit).toBeCloseTo(100_000 * ASSUMED_MARGIN, 0);
    expect(fig(i, 'expenses').now).toBe(4_000);
    expect(fig(i, 'net').now).toBeCloseTo(profit - 4_000, 0);
    expect(fig(i, 'net').now).not.toBe(100_000 - 4_000);
    expect(i.margin.now).toBeCloseTo(((profit - 4_000) / 100_000) * 100, 1);
  });
  it('costs a sale from the 24k rate typed with it', () => {
    // 5 g at 20,000 a gram, less 6 ratti: cost 93,750; a 100,000 sale earns 6,250.
    const i = run({ invoices: [inv({ costRate24k: 20_000 })] });
    expect(fig(i, 'profit').now).toBeCloseTo(6_250, 0);
  });
});

describe('gold coins', () => {
  it('stay out of revenue, profit and the rankings, and have their own card', () => {
    const coin = inv({ id: 'COIN', items: [item({ sku: 'C1', name: 'Coin', categoryId: 'cat017', itemTotal: 300_000, metalWeightG: 10 })], subtotal: 300_000, grandTotal: 300_000 });
    const i = run({ invoices: [inv({}), coin] });
    expect(fig(i, 'revenue').now).toBe(100_000);
    expect(fig(i, 'sales').now).toBe(1);
    expect(i.products.map(p => p.name)).toEqual(['Ring']);
    expect(i.coins).toMatchObject({ invoices: 1, grams: 10, revenue: { now: 300_000 } });
  });
});

describe('the days, the months and the rankings', () => {
  it('puts a sale after midnight Karachi time on the new day, and the days add up to revenue', () => {
    const i = run({
      invoices: [inv({ createdAt: '2026-08-31T20:00:00.000Z' }), inv({ id: 'B', createdAt: '2026-09-30T10:00:00.000Z' })],
      orders: [order({ createdAt: '2026-09-15T08:00:00.000Z' })],
    });
    expect(i.daily).toHaveLength(30);
    expect(i.daily[0].revenue).toBe(100_000);
    expect(i.daily[29].revenue).toBe(100_000);
    expect(i.daily.reduce((s, d) => s + d.revenue, 0)).toBe(fig(i, 'revenue').now);
    expect(fig(i, 'revenue').now).toBe(400_000);
  });
  it('gives thirteen months, oldest first, the last the report\'s own', () => {
    const i = run({ invoices: [inv({}), inv({ id: 'B', createdAt: '2025-09-10T08:00:00.000Z' })] });
    expect(i.trend).toHaveLength(13);
    expect(i.trend[0].key).toBe('2025-09');
    expect(i.trend[12].key).toBe('2026-09');
    expect(i.trend[0].revenue).toBe(100_000);
    expect(i.trend[12].revenue).toBe(fig(i, 'revenue').now);
    expect(i.trend.map(p => p.partial)).toEqual(Array(13).fill(false));
    expect(run({}, new Date('2026-09-12T08:00:00Z')).trend[12].partial).toBe(true);
  });
  it('ranks categories, pieces and customers by what they brought, walk-ins as one row', () => {
    const i = run({
      invoices: [
        inv({ id: 'A', customerName: 'Sakina' }),
        inv({ id: 'B', customerName: 'Sakina', items: [item({ sku: 'B1', name: 'Bangle', categoryId: 'cat002', itemTotal: 250_000 })], subtotal: 250_000, grandTotal: 250_000 }),
        inv({ id: 'C', customerName: 'Walk-in Customer' }),
        inv({ id: 'D', customerName: '' }),
      ],
    });
    expect(i.categories.map(c => c.amount)).toEqual([300_000, 250_000]);
    expect(i.categories).toHaveLength(2);
    expect(i.products.map(p => [p.name, p.amount, p.count])).toEqual([['Ring', 300_000, 3], ['Bangle', 250_000, 1]]);
    expect(i.customers[0]).toMatchObject({ name: 'Sakina', amount: 350_000, count: 2 });
    expect(i.customers.find(c => c.name === 'Walk-in customers')).toMatchObject({ amount: 200_000, count: 2 });
  });
});

describe('orders in flight', () => {
  it('says where the month\'s orders stand and what is still to collect', () => {
    const i = run({ orders: [
      order({ id: 'O1', status: 'Pending' }),
      order({ id: 'O2', status: 'In Progress' }),
      order({ id: 'O3', status: 'Completed' }),
      order({ id: 'O4', status: 'Completed', invoiceId: 'INV-9' }),
      order({ id: 'O5', status: 'Cancelled' }),
      order({ id: 'O6', status: 'Pending', createdAt: '2026-07-01T08:00:00.000Z' }),
    ], invoices: [inv({ id: 'INV-9', sourceOrderId: 'O4' })] });
    expect(i.orders).toMatchObject({ taken: 4, takenValue: 800_000, nowPending: 1, nowInProgress: 1, nowReady: 1, nowInvoiced: 1, cancelled: 1 });
    expect(i.orders.invoicedFromOrders).toEqual({ count: 1, value: 100_000 });
    // O1, O2, O3 and O6 are open (not invoiced, not cancelled), each 200,000 with 50,000 down.
    expect(i.orders.open).toEqual({ count: 4, value: 800_000, advances: 200_000, balance: 600_000 });
  });
});

describe('the axis', () => {
  it('holds the data on whole steps, with room below zero for a loss', () => {
    expect(niceScale(0, 1_230_000)).toEqual({ lo: 0, hi: 1_500_000, step: 500_000 });
    const s = niceScale(-700_000, 2_000_000);
    expect(s.lo).toBeLessThanOrEqual(-700_000);
    expect(s.hi).toBeGreaterThanOrEqual(2_000_000);
    expect(niceScale(0, 0).hi).toBeGreaterThan(0);
  });
});

describe('the report, both houses', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const houses = {
    taheri: {},
    mina: { NEXT_PUBLIC_STORE_BRAND: 'mina', NEXT_PUBLIC_STORE_NAME: 'House of Mina', NEXT_PUBLIC_STORE_PALETTE: '{"light":{"accent":"#380000"}}', NEXT_PUBLIC_STORE_COST_RATTI_LESS: 'none' },
  } as const;
  for (const [house, env] of Object.entries(houses)) {
    it(`draws ${house}'s PDF from a year of sales, small enough for WhatsApp`, async () => {
      vi.resetModules();
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const { buildMonthlyReport: build } = await import('./monthly');
      const { buildMonthlyPdf } = await import('./monthly-pdf');
      const { sampleShop: shop } = await import('./monthly-fixture');
      const report = build(shop(), { year: 2026, month: 9 }, new Date('2026-10-01T04:00:00Z'));
      const doc = buildMonthlyPdf(report, null);
      const bytes = new Uint8Array(doc.output('arraybuffer'));
      expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-');
      expect(doc.getNumberOfPages()).toBeGreaterThan(1);
      expect(bytes.length).toBeLessThan(2_000_000);
      const text = new TextDecoder('latin1').decode(bytes);
      expect(text).toContain('September 2026');
      expect(report.insights.trend).toHaveLength(13);
    });
  }
  it('still draws a month with nothing in it', () => {
    const empty = buildMonthlyReport({ invoices: [], orders: [], expenses: [], extraRevenues: [] }, sep, after);
    expect(() => drawPdf(empty, null)).not.toThrow();
    expect(empty.insights.daily.every(d => d.revenue === 0)).toBe(true);
    expect(sampleShop().invoices.length).toBeGreaterThan(100);
  });
});
