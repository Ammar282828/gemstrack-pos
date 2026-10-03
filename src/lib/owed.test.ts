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

describe("with the hisaab's hand-written balances", () => {
  const book = [inv('INV-20', 30_000, { customerId: 'c1', customerName: 'Sakina' })];
  const ledger = [
    // The old khata for Sakina: 1,00,000 given, 40,000 paid.
    { entityId: 'c1', entityType: 'customer', cashDebit: 100_000, cashCredit: 0 },
    { entityId: 'c1', entityType: 'customer', cashDebit: 0, cashCredit: 40_000 },
    // INV-20's own row: the invoice already counts it.
    { entityId: 'c1', entityType: 'customer', cashDebit: 30_000, cashCredit: 0, linkedInvoiceId: 'INV-20' },
    // A khata-only customer, and one the shop owes (an advance): that one lowers nobody's debt.
    { entityId: 'c9', entityType: 'customer', cashDebit: 5_000, cashCredit: 0 },
    { entityId: 'c8', entityType: 'customer', cashDebit: 0, cashCredit: 12_000 },
    // A settled account, and a karigar's gold — neither is owed.
    { entityId: 'c7', entityType: 'customer', cashDebit: 8_000, cashCredit: 8_000 },
    { entityId: 'k1', entityType: 'karigar', cashDebit: 50_000, cashCredit: 0 },
  ];
  const o = owedToYou(book, undefined, ledger);

  it('adds each customer the ledger says owes, once, beside the invoices', () => {
    expect(o.ledger).toBe(65_000);
    expect(o.total).toBe(95_000);
    expect(o.byKey.get('c1')).toEqual({ amount: 90_000, count: 1 });
    expect(o.byKey.get('c9')).toEqual({ amount: 5_000, count: 0 });
    expect(o.byKey.has('c8')).toBe(false);
    expect(o.byKey.has('c7')).toBe(false);
    expect(o.byKey.has('k1')).toBe(false);
  });
  it('is the invoices alone when no ledger is given', () => {
    expect(owedToYou(book).total).toBe(30_000);
    expect(owedToYou(book).ledger).toBe(0);
  });
});
