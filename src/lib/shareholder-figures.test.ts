import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CUTOFF, REVENUE_CUTOFF, ledgerRowFrom, partnerPositions, partnershipTotals, salariesByPartner, salaryGap,
  type ShareholderLedgerRow,
} from './shareholder-figures';

// The Shareholders page's figures, case for case with the iPhone app's port (apps/iphone/Packages/ERPCore,
// ShareholderFiguresTests). All names and amounts made up.

const PARTNERS = [{ id: 'mina', name: 'Mina' }, { id: 'ammar', name: 'Ammar' }] as const;

const row = (id: string, type: 'payment' | 'withdrawal', category: 'equity' | 'loan', amount: number): ShareholderLedgerRow => ({
  id, description: `Entry ${id}`, amount, date: new Date('2026-09-15T12:00:00.000Z'), category, type,
});

describe('the partnership\'s profit and loss', () => {
  const expenses = [
    { id: 'e1', date: '2025-07-01T10:00:00.000Z', amount: 9_999, category: 'Rent', description: 'Before the partnership' },
    { id: 'e2', date: '2025-07-02T10:00:00.000Z', amount: 20_000, category: 'Rent', description: 'Rent' },
    { id: 'e3', date: '2026-01-10T10:00:00.000Z', amount: 6_000, category: 'Partner Salary', shareholderId: 'mina', description: 'Mina salary — January' },
    { id: 'e4', date: '2026-02-10T10:00:00.000Z', amount: 15_000, category: 'Partner Drawings', description: 'Ammar — capital returned' },
    { id: 'e5', date: '', amount: 1_000, category: 'Rent', description: 'No date' },
  ];
  const orders = [
    { id: 'ORD-1', createdAt: '2025-07-10T10:00:00.000Z', subtotal: 50_000, invoiceId: 'INV-1' },
    { id: 'ORD-2', createdAt: '2025-08-01T10:00:00.000Z', subtotal: 30_000, status: 'Pending' },
    { id: 'ORD-3', createdAt: '2025-08-02T10:00:00.000Z', subtotal: 8_000, status: 'Cancelled' },
    { id: 'ORD-4', createdAt: '2025-08-03T10:00:00.000Z', subtotal: 9_000, status: 'Refunded' },
    { id: 'ORD-5', createdAt: '2025-08-04T10:00:00.000Z', subtotal: 7_000 },
    { id: 'ORD-6', createdAt: '2025-07-15T10:00:00.000Z', subtotal: 4_000 },
  ];
  const invoices = [
    // Billed after the cutoff for an order taken before it: left out, as the page leaves it.
    { id: 'INV-1', createdAt: '2025-08-01T10:00:00.000Z', sourceOrderId: 'ORD-1', grandTotal: 50_000 },
    { id: 'INV-2', createdAt: '2025-09-01T10:00:00.000Z', grandTotal: 40_000, exchanges: [{ description: 'Old chain', value: 10_000 }] },
    { id: 'INV-3', createdAt: '2025-09-02T10:00:00.000Z', grandTotal: 70_000, status: 'Refunded' },
    // ORD-5's invoice: the order is billed, so only the invoice counts.
    { id: 'INV-4', createdAt: '2025-09-03T10:00:00.000Z', sourceOrderId: 'ORD-5', grandTotal: 7_000 },
  ];
  const extra = [
    { date: '2025-07-15T10:00:00.000Z', amount: 500 },
    { date: '2025-07-16T00:00:00.000Z', amount: 2_500 },
  ];

  it('counts from the cutoffs, leaves drawings out of the costs and counts them apart', () => {
    const t = partnershipTotals(expenses, invoices as never, orders, extra);
    expect(t.totalExpenses).toBe(26_000);
    expect(t.drawings).toBe(15_000);
    // INV-2 with its exchange, INV-4, ORD-2 unbilled, the extra revenue from the 16th.
    expect(t.totalRevenue).toBe(50_000 + 7_000 + 30_000 + 2_500);
    expect(t.expShare).toBe(13_000);
    expect(t.revShare).toBe(44_750);
  });

  it('starts on the cutoff days themselves', () => {
    expect(EXPENSE_CUTOFF).toBe('2025-07-02');
    expect(REVENUE_CUTOFF).toBe('2025-07-16');
  });
});

describe('salaries', () => {
  it('are the Partner Salary expenses that name a partner, newest first', () => {
    const s = salariesByPartner([
      { id: 's1', date: '2026-01-10T10:00:00.000Z', amount: 6_000, category: 'Partner Salary', shareholderId: 'mina', description: 'a' },
      { id: 's2', date: '2026-03-10T10:00:00.000Z', amount: 6_000, category: 'Partner Salary', shareholderId: 'mina', description: 'b' },
      { id: 's3', date: '2026-02-10T10:00:00.000Z', amount: 4_000, category: 'Partner Salary', shareholderId: 'ammar', description: 'c' },
      { id: 's4', date: '2026-02-11T10:00:00.000Z', amount: 4_000, category: 'Partner Salary', description: 'nobody named' },
      { id: 's5', date: '2026-02-12T10:00:00.000Z', amount: 4_000, category: 'Rent', shareholderId: 'mina', description: 'not a salary' },
    ]);
    expect(s.mina.map(e => e.id)).toEqual(['s2', 's1']);
    expect(s.ammar.map(e => e.id)).toEqual(['s3']);
  });

  it('a gap moves half of it from one partner to the other; under a rupee is none', () => {
    const g = salaryGap([{ name: 'Mina', salaryPaid: 30_000 }, { name: 'Ammar', salaryPaid: 10_000 }]);
    expect(g?.ahead.name).toBe('Mina');
    expect(g?.behind.name).toBe('Ammar');
    expect(g?.transferred).toBe(10_000);
    expect(salaryGap([{ name: 'Mina', salaryPaid: 0 }, { name: 'Ammar', salaryPaid: 8_000 }])?.ahead.name).toBe('Ammar');
    expect(salaryGap([{ salaryPaid: 5_000.4 }, { salaryPaid: 5_000 }])).toBeNull();
    expect(salaryGap([{ salaryPaid: 5_000 }])).toBeNull();
  });
});

describe('each partner\'s position', () => {
  it('is their ledger plus their half of the P&L', () => {
    const ledgers = {
      mina: [row('m1', 'payment', 'equity', 100_000), row('m2', 'payment', 'loan', 40_000), row('m3', 'withdrawal', 'equity', 10_000)],
      ammar: [row('a1', 'payment', 'equity', 60_000), row('a2', 'withdrawal', 'loan', 5_000)],
    };
    const salaries = { mina: [{ id: 's1', date: '2026-01-10', amount: 6_000, description: 'x' }], ammar: [] };
    const [mina, ammar] = partnerPositions(PARTNERS, ledgers, salaries, { expShare: 13_000, revShare: 44_750 });
    expect(mina).toMatchObject({ id: 'mina', name: 'Mina', contributed: 140_000, withdrawn: 10_000, salaryPaid: 6_000 });
    expect(mina.balance).toEqual({ equityBalance: 90_000, loanBalance: 40_000, netPnL: 31_750, totalClaim: 161_750 });
    expect(mina.payments.map(r => r.id)).toEqual(['m1', 'm2']);
    expect(mina.withdrawals.map(r => r.id)).toEqual(['m3']);
    expect(ammar).toMatchObject({ contributed: 60_000, withdrawn: 5_000, salaryPaid: 0 });
    expect(ammar.balance).toEqual({ equityBalance: 60_000, loanBalance: -5_000, netPnL: 31_750, totalClaim: 86_750 });
  });

  it('a partner with no ledger yet stands at their half of the P&L', () => {
    const [mina] = partnerPositions(PARTNERS, {}, {}, { expShare: 10_000, revShare: 4_000 });
    expect(mina.balance.totalClaim).toBe(-6_000);
    expect(mina.rows).toEqual([]);
  });
});

describe('a ledger document', () => {
  const when = new Date('2026-09-01T00:00:00.000Z');

  it('reads as the page reads it', () => {
    expect(ledgerRowFrom('x1', { description: 'Bank transfer', amount: '25000', category: 'loan', type: 'withdrawal', linkedExpenseId: 'exp-1' }, when))
      .toEqual({ id: 'x1', description: 'Bank transfer', amount: 25_000, date: when, category: 'loan', type: 'withdrawal', linkedExpenseId: 'exp-1' });
  });

  it('an entry from before the split is equity, anything else is a payment, and "pending" is no link', () => {
    expect(ledgerRowFrom('x2', { amount: 'lots', linkedExpenseId: 'pending' }, when))
      .toEqual({ id: 'x2', description: '', amount: 0, date: when, category: 'equity', type: 'payment', linkedExpenseId: undefined });
  });
});
