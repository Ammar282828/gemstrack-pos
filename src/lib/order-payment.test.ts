import { describe, it, expect } from 'vitest';
import { orderAdvancePayments, withoutOrderAdvance } from './order-payment';

const base = { id: 'ORD-000123', createdAt: '2026-09-01T10:00:00.000Z' };

describe('orderAdvancePayments', () => {
  it('an advance taken with the order is one payment on the order date, as it was paid', () => {
    expect(orderAdvancePayments({ ...base, advancePayment: 50000, advanceMethod: 'Bank Transfer' })).toEqual([
      { amount: 50000, date: base.createdAt, notes: 'Advance on order ORD-000123', method: 'Bank Transfer' },
    ]);
  });
  it('advances recorded later keep their own day, method and note', () => {
    const later = { amount: 20000, date: '2026-09-10T12:00:00.000Z', method: 'Cash' as const, notes: 'Second advance' };
    expect(orderAdvancePayments({ ...base, advancePayment: 70000, advances: [later] })).toEqual([
      { amount: 50000, date: base.createdAt, notes: 'Advance on order ORD-000123' },
      { ...later, notes: 'Advance on order ORD-000123: Second advance' },
    ]);
  });
  it('all of it recorded later: no payment on the order date', () => {
    const later = { amount: 30000, date: '2026-09-10T12:00:00.000Z' };
    expect(orderAdvancePayments({ ...base, advancePayment: 30000, advances: [later] })).toHaveLength(1);
  });
  it('a total edited below its list is trusted as one advance', () => {
    const later = { amount: 30000, date: '2026-09-10T12:00:00.000Z' };
    expect(orderAdvancePayments({ ...base, advancePayment: 10000, advances: [later] })).toEqual([
      { amount: 10000, date: base.createdAt, notes: 'Advance on order ORD-000123' },
    ]);
  });
  it('no advance, no payments', () => {
    expect(orderAdvancePayments({ ...base, advancePayment: 0 })).toEqual([]);
  });
});


describe('withoutOrderAdvance', () => {
  const order = {
    id: 'ORD-1', createdAt: '2026-09-01', advancePayment: 100_000, advanceMethod: 'Cash' as const,
    advances: [{ amount: 30_000, date: '2026-09-10', method: 'Bank Transfer' as const }, { amount: 0, date: 'x' }, { amount: 20_000, date: '2026-09-20' }],
  };
  it('the advance taken with the order goes with its method', () => {
    expect(withoutOrderAdvance(order, 0)).toMatchObject({ advancePayment: 50_000, dropMethod: true, removed: { amount: 50_000 } });
    expect(withoutOrderAdvance(order, 0)!.advances).toHaveLength(3);
  });
  it('a later advance comes off the list and the total', () => {
    const r = withoutOrderAdvance(order, 2)!;
    expect(r).toMatchObject({ advancePayment: 80_000, dropMethod: false, removed: { amount: 20_000 } });
    expect(r.advances.map((a) => a.amount)).toEqual([30_000, 0]);
  });
  it('a total edited below its list goes as the one advance it is shown as', () => {
    expect(withoutOrderAdvance({ ...order, advancePayment: 10_000 }, 0)).toMatchObject({ advancePayment: 0, advances: [], dropMethod: true });
  });
  it('nothing for a line that is not there', () => {
    expect(withoutOrderAdvance(order, 9)).toBeNull();
  });
});
