import { describe, expect, it } from 'vitest';
import { isOwing, owedToYou } from './owed';

const inv = (id: string, balanceDue: number, extra: Record<string, unknown> = {}) => ({ id, balanceDue, createdAt: `2026-09-${id.slice(-2)}`, ...extra });

describe('what customers owe the shop', () => {
  const book = [
    inv('INV-10', 50_000, { customerId: 'c1', customerName: 'Sakina' }),
    inv('INV-11', 20_000, { customerId: 'c1', customerName: 'Sakina' }),
    inv('INV-12', 9_000, { customerName: 'Walk-in Customer' }),
    inv('INV-13', 4_000, { customerName: 'Fatema (typed)' }),
    inv('INV-14', 0, { customerId: 'c2' }),
    inv('INV-15', 80_000, { customerId: 'c3', status: 'Refunded' }),
    inv('INV-16', 0.2, { customerId: 'c4' }),
  ];
  const o = owedToYou(book);

  it('counts every invoice still owed on, walk-ins and typed names included; never a refund or a rounding crumb', () => {
    expect(o.total).toBe(83_000);
    expect(o.invoices.map(i => i.id)).toEqual(['INV-10', 'INV-11', 'INV-12', 'INV-13']);
    expect(isOwing(book[6])).toBe(false);
  });
  it('by customer, with walk-ins as one line and typed names as their own', () => {
    expect(o.byKey.get('c1')).toEqual({ amount: 70_000, count: 2 });
    expect(o.byKey.get('walk-in')).toEqual({ amount: 9_000, count: 1 });
    expect(o.byKey.get('name:Fatema (typed)')).toEqual({ amount: 4_000, count: 1 });
    expect(o.walkIn).toBe(9_000);
    expect(o.nameOnly).toBe(4_000);
  });
});
