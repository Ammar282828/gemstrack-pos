import { describe, it, expect } from 'vitest';
import { dueBucketOf, dueGroups, isOpenOrder, DUE_BUCKETS } from './orders-due';
import { orderTiming } from './order-timing';

const NOW = new Date(2026, 9, 12, 15, 0, 0); // 12 Oct 2026
const iso = (offsetDays: number) => new Date(2026, 9, 12 + offsetDays, 10, 0, 0).toISOString();
const order = (id: string, o: Record<string, unknown> = {}) =>
  ({ id, status: 'Pending', createdAt: iso(-1), ...o }) as any;
const bucket = (o: any) => dueBucketOf(orderTiming(o, NOW));

describe('dueBucketOf (thresholds as the app)', () => {
  it('past the promised day is Late', () => expect(bucket(order('a', { promisedDate: iso(-1) }))).toBe('late'));
  it('the promised day is Today', () => expect(bucket(order('a', { promisedDate: iso(0) }))).toBe('today'));
  it('1 to 7 days ahead is This week', () => {
    expect(bucket(order('a', { promisedDate: iso(1) }))).toBe('week');
    expect(bucket(order('a', { promisedDate: iso(7) }))).toBe('week');
  });
  it('8 days ahead and more is Later', () => {
    expect(bucket(order('a', { promisedDate: iso(8) }))).toBe('later');
    expect(bucket(order('a', { promisedDate: iso(60) }))).toBe('later');
  });
  it('no promise is No date, even when old enough for the age rule to call it late', () => {
    expect(bucket(order('a', { createdAt: iso(-30) }))).toBe('undated');
    expect(bucket(order('a', { createdAt: iso(-1) }))).toBe('undated');
  });
});

describe('isOpenOrder', () => {
  it('is false for invoiced, cancelled and refunded', () => {
    expect(isOpenOrder(order('a'))).toBe(true);
    expect(isOpenOrder(order('a', { status: 'Completed' }))).toBe(true);
    expect(isOpenOrder(order('a', { invoiceId: 'INV-1' }))).toBe(false);
    expect(isOpenOrder(order('a', { status: 'Cancelled' }))).toBe(false);
    expect(isOpenOrder(order('a', { status: 'Refunded' }))).toBe(false);
  });
});

describe('dueGroups', () => {
  it('buckets in the chase order and leaves empty ones out', () => {
    const g = dueGroups([
      order('later', { promisedDate: iso(20) }),
      order('late', { promisedDate: iso(-3) }),
      order('none'),
    ], NOW);
    expect(g.map(x => x.bucket)).toEqual(['late', 'later', 'undated']);
    expect(DUE_BUCKETS.map(b => b.key)).toEqual(['late', 'today', 'week', 'later', 'undated']);
  });

  it('leaves out invoiced, cancelled and refunded orders', () => {
    const g = dueGroups([
      order('x1', { promisedDate: iso(0), invoiceId: 'INV-1' }),
      order('x2', { promisedDate: iso(0), status: 'Cancelled' }),
      order('x3', { promisedDate: iso(0), status: 'Refunded' }),
      order('ok', { promisedDate: iso(0) }),
    ], NOW);
    expect(g).toEqual([{ bucket: 'today', orders: [expect.objectContaining({ id: 'ok' })] }]);
  });

  it('sorts the soonest promise first, so the latest of the late comes last', () => {
    const g = dueGroups([
      order('b', { promisedDate: iso(-1) }),
      order('a', { promisedDate: iso(-5) }),
      order('c', { promisedDate: iso(-3) }),
    ], NOW);
    expect(g[0].orders.map(o => o.id)).toEqual(['a', 'c', 'b']);
  });

  it('breaks ties by the day taken, then id; undated oldest first', () => {
    const g = dueGroups([
      order('z', { promisedDate: iso(2), createdAt: iso(-2) }),
      order('y', { promisedDate: iso(2), createdAt: iso(-9) }),
      order('x', { promisedDate: iso(2), createdAt: iso(-2) }),
      order('n2', { createdAt: iso(-1) }),
      order('n1', { createdAt: iso(-20) }),
    ], NOW);
    expect(g.find(x => x.bucket === 'week')!.orders.map(o => o.id)).toEqual(['y', 'x', 'z']);
    expect(g.find(x => x.bucket === 'undated')!.orders.map(o => o.id)).toEqual(['n1', 'n2']);
  });
});
