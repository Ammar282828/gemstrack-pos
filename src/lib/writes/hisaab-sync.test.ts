import { describe, expect, it } from 'vitest';
import { planHisaabSync } from './hisaab-sync';

// All made up.
const out = (id: string) => `Outstanding balance for Invoice ${id}`;
const credit = (id: string) => `Credit held for Invoice ${id}`;

describe('the hisaab kept in step with the invoices', () => {
  it('an owed invoice gets one outstanding row of the right amount; duplicates and stale credit go', () => {
    const plan = planHisaabSync(
      [{ id: 'I1', customerId: 'c1', customerName: 'Demo', balanceDue: 500 }],
      [
        { id: 'a', linkedInvoiceId: 'I1', description: out('I1'), cashDebit: 300 },
        { id: 'b', linkedInvoiceId: 'I1', description: out('I1'), cashDebit: 300 },
        { id: 'c', linkedInvoiceId: 'I1', description: credit('I1'), cashCredit: 50 },
      ],
      [],
    );
    expect(plan.updates).toEqual([{ id: 'a', patch: { cashDebit: 500, cashCredit: 0 } }]);
    expect(plan.deletes.sort()).toEqual(['b', 'c']);
    expect(plan.creates).toEqual([]);
  });

  it('an overpaid invoice holds its credit; a settled or refunded one keeps neither', () => {
    const plan = planHisaabSync(
      [
        { id: 'I2', customerId: 'c2', customerName: 'Demo', balanceDue: -200 },
        { id: 'I3', customerId: 'c3', balanceDue: 0 },
        { id: 'I4', customerId: 'c4', balanceDue: 900, status: 'Refunded' },
      ],
      [
        { id: 'd', linkedInvoiceId: 'I2', description: out('I2'), cashDebit: 100 },
        { id: 'e', linkedInvoiceId: 'I3', description: out('I3'), cashDebit: 100 },
        { id: 'f', linkedInvoiceId: 'I4', description: out('I4'), cashDebit: 900 },
      ],
      [],
    );
    expect(plan.deletes.sort()).toEqual(['d', 'e', 'f']);
    expect(plan.creates).toEqual([expect.objectContaining({ entityId: 'c2', cashCredit: 200, cashDebit: 0, description: credit('I2') })]);
  });

  it('a Shopify import owed with no row gets one, matched by name; never a walk-in, never a stranger', () => {
    const plan = planHisaabSync(
      [
        { id: 'S1', customerName: 'Demo Shopify', balanceDue: 1_000, createdAt: '2026-10-01T00:00:00Z' },
        { id: 'S2', customerName: 'Walk-in Customer', balanceDue: 1_000 },
        { id: 'S3', customerName: 'Nobody Known', balanceDue: 1_000 },
      ],
      [{ id: 'typed', description: 'By hand', cashDebit: 9 }],
      [{ id: 'cs', name: 'demo shopify' }, { id: 'wk', name: 'Walk-in Customer' }],
    );
    expect(plan.creates).toEqual([expect.objectContaining({ entityId: 'cs', cashDebit: 1_000, linkedInvoiceId: 'S1', date: '2026-10-01T00:00:00Z' })]);
    expect(plan.deletes).toEqual([]);
  });

  it('rows of an invoice that is gone are removed; rows typed by hand never are', () => {
    const plan = planHisaabSync([], [{ id: 'g', linkedInvoiceId: 'GONE', cashDebit: 1 }, { id: 'h', cashDebit: 1 }], []);
    expect(plan.deletes).toEqual(['g']);
  });
});
