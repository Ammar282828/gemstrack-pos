import { describe, expect, it } from 'vitest';
import type { AdditionalRevenue, Expense, Invoice, Order } from '@/lib/store';
import { addMonths, buildMonthlyReport, karachiMonth, monthBounds, monthKey, monthlyCaption, parseMonth } from './monthly';
import { buildMonthlyPdf, plain } from './monthly-pdf';

const item = (over: Partial<Invoice['items'][number]> = {}) => ({
  sku: 'R1', name: 'Ring', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 5, stoneWeightG: 0, quantity: 1,
  unitPrice: 100_000, itemTotal: 100_000, metalCost: 0, wastageCost: 0, wastagePercentage: 0, makingCharges: 0,
  diamondChargesIfAny: 0, stoneChargesIfAny: 0, miscChargesIfAny: 0, ...over,
}) as Invoice['items'][number];

const inv = (over: Partial<Invoice>): Invoice => ({
  id: 'INV-1', customerName: 'Sakina', items: [item()], subtotal: 100_000, discountAmount: 0, grandTotal: 100_000,
  amountPaid: 100_000, balanceDue: 0, createdAt: '2026-09-10T08:00:00.000Z', ratesApplied: {}, paymentHistory: [], ...over,
}) as Invoice;

const order = (over: Partial<Order>): Order => ({
  id: 'ORD-1', createdAt: '2026-09-05T08:00:00.000Z', status: 'In Progress', items: [], subtotal: 200_000, advancePayment: 0,
  grandTotal: 200_000, customerName: 'Batool', summary: 'Bangles', ...over,
}) as Order;

const sep = { year: 2026, month: 9 };
const now = new Date('2026-10-01T04:00:00Z');
const build = (p: { invoices?: Invoice[]; orders?: Order[]; expenses?: Expense[]; extra?: AdditionalRevenue[] }, at = now) =>
  buildMonthlyReport({ invoices: p.invoices ?? [], orders: p.orders ?? [], expenses: p.expenses ?? [], extraRevenues: p.extra ?? [] }, sep, at);

describe('the month', () => {
  it('is Karachi\'s month, whatever the server clock says', () => {
    const b = monthBounds(sep);
    expect(b.from.toISOString()).toBe('2026-08-31T19:00:00.000Z');
    expect(b.to.toISOString()).toBe('2026-09-30T18:59:59.999Z');
    // 1 am on 1 October in Karachi is still 30 September in UTC.
    expect(karachiMonth(new Date('2026-09-30T20:00:00Z'))).toEqual({ year: 2026, month: 10 });
  });
  it('reads and steps months', () => {
    expect(parseMonth('2026-09')).toEqual(sep);
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('Sept')).toBeNull();
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthKey(addMonths(sep, 4))).toBe('2027-01');
  });
  it('counts a sale made after midnight Karachi time on the 1st in the new month', () => {
    const r = build({ invoices: [inv({ createdAt: '2026-08-31T20:00:00.000Z' })] });
    expect(r.sales.map(s => s.id)).toEqual(['INV-1']);
  });
});

describe('revenue, as Analytics adds it up', () => {
  it('counts exchange as part of the sale, open orders at full value, and other income', () => {
    const r = build({
      invoices: [inv({ exchanges: [{ description: 'Old ring', value: 40_000 }], grandTotal: 60_000, amountPaid: 60_000 })],
      orders: [order({})],
      extra: [{ id: 'x', date: '2026-09-12', description: 'Repair REP-000003', amount: 3_000 }],
    });
    expect(r.revenue).toMatchObject({ invoices: 100_000, openOrders: 200_000, other: 3_000, total: 303_000 });
    expect(r.sales[0]).toMatchObject({ value: 100_000, exchange: 40_000 });
  });
  it('puts an invoice made from an order on the order\'s day, and says when it was invoiced', () => {
    const r = build({
      orders: [order({ id: 'ORD-9', createdAt: '2026-08-20T08:00:00.000Z', status: 'Completed', invoiceId: 'INV-9' })],
      invoices: [inv({ id: 'INV-9', sourceOrderId: 'ORD-9', createdAt: '2026-09-15T08:00:00.000Z' })],
    });
    expect(r.sales).toEqual([]);
    const aug = buildMonthlyReport({
      invoices: [inv({ id: 'INV-9', sourceOrderId: 'ORD-9', createdAt: '2026-09-15T08:00:00.000Z' })],
      orders: [order({ id: 'ORD-9', createdAt: '2026-08-20T08:00:00.000Z', status: 'Completed', invoiceId: 'INV-9' })],
      expenses: [], extraRevenues: [],
    }, { year: 2026, month: 8 }, now);
    expect(aug.sales[0]).toMatchObject({ id: 'INV-9', orderId: 'ORD-9', invoicedOn: '2026-09-15T08:00:00.000Z' });
    expect(aug.openOrders).toEqual([]);
  });
  it('lists a refund but counts nothing for it, and leaves cancelled orders out', () => {
    const r = build({
      invoices: [inv({ id: 'INV-2', status: 'Refunded' }), inv({ id: 'INV-3' })],
      orders: [order({ status: 'Cancelled' })],
    });
    expect(r.sales.map(s => [s.id, s.refunded])).toEqual([['INV-2', true], ['INV-3', false]]);
    expect(r.revenue.total).toBe(100_000);
    expect(r.counts).toMatchObject({ invoices: 1, refunded: 1, openOrders: 0 });
  });
  it('keeps gold coins out of revenue but lists the sale', () => {
    const r = build({ invoices: [inv({ id: 'INV-C', items: [item({ categoryId: 'cat017', name: '10g coin', karat: '24k' })] })] });
    expect(r.revenue).toMatchObject({ total: 0, coins: 100_000 });
    expect(r.sales[0]).toMatchObject({ id: 'INV-C', coin: true });
  });
  it('weighs the metal sold by karat', () => {
    const r = build({ invoices: [inv({ items: [item({ metalWeightG: 5 }), item({ metalWeightG: 2.5, karat: '22k' }), item({ metalWeightG: 1, quantity: 2 })] })] });
    expect(r.metal).toEqual([{ label: 'Gold 21K', grams: 7 }, { label: 'Gold 22K', grams: 2.5 }]);
    expect(r.counts.pieces).toBe(4);
  });
});

describe('money in and out', () => {
  it('lists every payment of the month by how it was paid, and advances only while the order is open', () => {
    const r = build({
      invoices: [inv({ paymentHistory: [
        { amount: 60_000, date: '2026-09-10T08:00:00.000Z', method: 'Cash' },
        { amount: 40_000, date: '2026-10-02T08:00:00.000Z', method: 'Bank Transfer' },
      ] })],
      orders: [
        order({ advancePayment: 50_000, advanceMethod: 'Card' }),
        order({ id: 'ORD-2', advancePayment: 20_000, invoiceId: 'INV-X', status: 'Completed' }),
      ],
    });
    expect(r.payments.map(p => [p.ref, p.method, p.amount])).toEqual([['ORD-1', 'Card', 50_000], ['INV-1', 'Cash', 60_000]]);
    expect(r.byMethod).toEqual([{ method: 'Cash', amount: 60_000 }, { method: 'Card', amount: 50_000 }]);
    expect(r.cashIn.total).toBe(110_000);
  });
  it('counts business expenses, and shows a partner\'s drawings without counting them', () => {
    const r = build({ expenses: [
      { id: 'e1', date: '2026-09-03', category: 'Rent', description: 'Shop', amount: 50_000 },
      { id: 'e2', date: '2026-09-04', category: 'Partner Drawings', description: 'Ammar', amount: 80_000 },
      { id: 'e3', date: '2026-08-30', category: 'Rent', description: 'August', amount: 50_000 },
    ] as Expense[] });
    expect(r.expenses).toMatchObject({ business: 50_000, drawings: 80_000, byCategory: [{ category: 'Rent', amount: 50_000 }] });
    expect(r.expenseRows.map(e => [e.category, e.business])).toEqual([['Rent', true], ['Partner Drawings', false]]);
    expect(r.previous).toMatchObject({ label: 'August 2026', expenses: 50_000 });
    expect(r.net).toBe(-50_000);
  });
  it('says what is still owed on the month and on everything', () => {
    const r = build({ invoices: [
      inv({ id: 'INV-1', balanceDue: 30_000 }),
      inv({ id: 'INV-OLD', createdAt: '2026-07-01T08:00:00.000Z', balanceDue: 12_000 }),
      inv({ id: 'INV-R', status: 'Refunded', balanceDue: 99_000 }),
    ] });
    expect(r.owed).toEqual({ onThisMonth: 30_000, allOpen: 42_000 });
  });
});

describe('the WhatsApp line and the PDF', () => {
  it('compares a finished month with the one before, and a running one with nothing', () => {
    const invoices = [inv({}), inv({ id: 'INV-A', createdAt: '2026-08-10T08:00:00.000Z', subtotal: 80_000, grandTotal: 80_000 })];
    expect(monthlyCaption(build({ invoices }))).toContain('▲ 25% on August');
    const running = build({ invoices }, new Date('2026-09-20T08:00:00Z'));
    expect(running.partial).toBe(true);
    expect(monthlyCaption(running)).not.toContain('on August');
    expect(monthlyCaption(running)).toContain('(so far)');
  });
  it('writes only characters the PDF font has', () => {
    expect(plain('Gold → 21K ▲ 5%')).toBe('Gold -> 21K + 5%');
    expect(plain('Sakina — “Ring” · 3×')).toBe('Sakina — “Ring” · 3×');
    expect(plain('فاطمہ Fatima 💍')).toBe(' Fatima ');
  });
  it('draws a PDF with every sale in it', () => {
    const invoices = Array.from({ length: 60 }, (_, i) => inv({ id: `INV-${1000 + i}`, customerName: `Customer ${i}` }));
    const doc = buildMonthlyPdf(build({ invoices }), null);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const text = new TextDecoder('latin1').decode(doc.output('arraybuffer'));
    expect(text).toContain('INV-1000');
    expect(text).toContain('INV-1059');
  });
});

