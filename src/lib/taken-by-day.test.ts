import { describe, expect, it } from 'vitest';
import { revenueForPeriod } from '@/lib/analytics/revenue-period';
import { METHOD_KEYS, type MethodSplit, splitByMethod, takenByDay, takenRange, type TakenInput } from './taken-by-day';

const from = new Date('2026-11-01T00:00:00');
const to = new Date('2026-11-04T00:00:00');

const input = {
  invoices: [
    // Cash 60k + bank 40k of a 150k sale: 50k not paid yet.
    { id: 'INV-1', customerName: 'Sara', createdAt: '2026-11-01T10:00:00', status: 'Paid', takenBy: 'Ammar', items: [{ name: 'Ring', itemTotal: 150000, categoryId: 'cat001' }], subtotal: 150000, grandTotal: 150000, amountPaid: 100000, balanceDue: 50000,
      paymentHistory: [{ amount: 60000, date: '2026-11-01T10:00:00', method: 'Cash' }, { amount: 40000, date: '2026-11-01T10:05:00', method: 'Bank Transfer' }] },
    // Old gold off the total: sale 200k = 150k cash + 50k exchange.
    { id: 'INV-2', customerName: 'Hina', createdAt: '2026-11-02T12:00:00', status: 'Paid', items: [{ name: 'Set', itemTotal: 200000, categoryId: 'cat013' }], subtotal: 200000, grandTotal: 150000, amountPaid: 150000, balanceDue: 0,
      exchanges: [{ description: 'old chain', value: 50000 }], paymentHistory: [{ amount: 150000, date: '2026-11-02T12:00:00', method: 'Card' }] },
    // A gold coin: not in Home's figure.
    { id: 'INV-3', customerName: 'Ali', createdAt: '2026-11-02T13:00:00', status: 'Paid', items: [{ name: 'Coin', itemTotal: 90000, categoryId: 'cat017' }], subtotal: 90000, grandTotal: 90000, amountPaid: 90000, balanceDue: 0, paymentHistory: [{ amount: 90000, date: '2026-11-02T13:00:00', method: 'Cash' }] },
    { id: 'INV-4', customerName: 'Gone', createdAt: '2026-11-02T14:00:00', status: 'Refunded', items: [], subtotal: 5, grandTotal: 5, amountPaid: 5, balanceDue: 0, paymentHistory: [] },
  ],
  orders: [
    { id: 'ORD-1', customerName: 'Noor', createdAt: '2026-11-03T09:00:00', status: 'Pending', subtotal: 80000, discountAmount: 0, advancePayment: 30000, advanceMethod: 'Cash', grandTotal: 50000, summary: 'Kada pair', takenBy: 'Ammar' },
    { id: 'ORD-2', customerName: 'Done', createdAt: '2026-11-03T09:00:00', status: 'Completed', invoiceId: 'INV-1', subtotal: 999, grandTotal: 0, advancePayment: 0 },
  ],
  extraRevenues: [
    { id: 'X1', date: '2026-11-03T15:00:00', description: 'Polish', amount: 1500 },
    { id: 'X2', date: '2026-11-03T16:00:00', description: 'Repair REP-1', amount: 4000, repairId: 'REP-1' },
    { id: 'X3', date: '2026-10-31T16:00:00', description: 'Last month', amount: 700 },
  ],
  repairs: [{ id: 'REP-1', customerName: 'Zoya', payments: [{ amount: 4000, date: '2026-11-03T16:00:00', method: 'Bank Transfer', revenueId: 'X2' }] }],
} as unknown as TakenInput;

const sum = (m: MethodSplit) => METHOD_KEYS.reduce((s, k) => s + m[k], 0);

describe('takenByDay', () => {
  const r = takenByDay(input, from, to);
  const home = revenueForPeriod({ invoices: input.invoices, orders: input.orders, extraRevenues: input.extraRevenues }, from, to);

  it('adds up to the rupee to what Home counts for the same range', () => {
    expect(home).toBe(150000 + 200000 + 80000 + 1500 + 4000);
    expect(r.total).toBeCloseTo(home, 6);
    // And day by day, as Home's own "today".
    for (const d of r.days) {
      const s = new Date(`${d.day}T00:00:00`);
      expect(d.total).toBeCloseTo(revenueForPeriod({ invoices: input.invoices, orders: input.orders, extraRevenues: input.extraRevenues }, s, new Date(s.getTime() + 86_400_000)), 6);
    }
  });
  it('has every day of the range, quiet ones too, and leaves coins and refunds out of the bars', () => {
    expect(r.days.map(d => d.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(r.days[1].total).toBe(200000);
    expect(r.days[1].coins).toBe(90000);
    expect(r.days[1].counts).toEqual({ invoice: 1, order: 0, repair: 0, extra: 0 });
  });
  it('splits each entry by what was recorded; the parts sum to the entry, the entries to the day', () => {
    const inv1 = r.days[0].entries[0];
    expect(inv1).toMatchObject({ id: 'INV-1', amount: 150000, who: 'Ammar', customer: 'Sara', method: 'Cash + Bank + Not paid yet', href: '/invoices/INV-1' });
    expect(inv1.methods).toEqual({ cash: 60000, bank: 40000, card: 0, other: 0, unpaid: 50000 });
    const inv2 = r.days[1].entries[0];
    expect(inv2.methods).toEqual({ cash: 0, bank: 0, card: 150000, other: 50000, unpaid: 0 });
    for (const d of r.days) {
      for (const e of d.entries) expect(sum(e.methods)).toBeCloseTo(e.amount, 6);
      expect(sum(d.methods)).toBeCloseTo(d.total, 6);
    }
    expect(sum(r.methods)).toBeCloseTo(r.total, 6);
  });
  it('counts an uninvoiced counter order at its subtotal with its advance, repairs by their method, extra revenue as other', () => {
    const d = r.days[2];
    expect(d.counts).toEqual({ invoice: 0, order: 1, repair: 1, extra: 1 });
    expect(d.amounts).toEqual({ invoice: 0, order: 80000, repair: 4000, extra: 1500 });
    const ord = d.entries.find(e => e.kind === 'order')!;
    expect(ord.methods).toEqual({ cash: 30000, bank: 0, card: 0, other: 0, unpaid: 50000 });
    expect(d.entries.find(e => e.kind === 'repair')).toMatchObject({ customer: 'Zoya', methods: { bank: 4000 }, href: '/repairs?id=REP-1' });
    expect(d.entries.find(e => e.kind === 'extra')!.methods.other).toBe(1500);
    // Newest first.
    expect(d.entries.map(e => e.id)).toEqual(['REP-1', 'X1', 'ORD-1']);
  });
});

describe('splitByMethod', () => {
  it('scales an overpayment back so the parts still sum to the amount', () => {
    const m = splitByMethod(100, { cash: 150, bank: 50 });
    expect(sum(m)).toBeCloseTo(100, 9);
    expect(m.unpaid).toBe(0);
    expect(m.cash).toBeCloseTo(75, 9);
  });
  it('a handed-back credit lowers its method; nothing paid is all unpaid', () => {
    expect(splitByMethod(100, { cash: 100, bank: -20 }).unpaid).toBeCloseTo(20, 9);
    expect(splitByMethod(100, {})).toEqual({ cash: 0, bank: 0, card: 0, other: 0, unpaid: 100 });
  });
});

describe('takenRange', () => {
  const now = new Date(2026, 10, 18, 15, 0);
  it('7 days ends today; this month starts on the 1st', () => {
    const w = takenRange('7d', now);
    expect(w.from).toEqual(new Date(2026, 10, 12)); expect(w.to).toEqual(new Date(2026, 10, 19));
    expect(takenRange('month', now).from).toEqual(new Date(2026, 10, 1));
    expect(takenRange('90d', now).from).toEqual(new Date(2026, 7, 21));
  });
});
