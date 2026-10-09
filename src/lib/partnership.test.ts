import { describe, expect, it, vi } from 'vitest';
import {
  PARTNER_DRAWINGS, PARTNER_SALARY, calculateDistribution, categorise, emptyCategorisedLedger, isBusinessCost, partnerBalance,
  type LedgerEntry,
} from './partnership';

// The client SDK is not wanted here: partnership-settings reads and writes Firestore, these cases only its date rules.
vi.mock('@/lib/firebase', () => ({ db: {} }));
const { DEFAULT_WORKING_CAPITAL_FLOOR, isFloorStale, isMonthStart } = await import('./partnership-settings');

// Partnership maths, case for case with the iPhone app's port (apps/iphone/Packages/ERPCore, PartnershipTests).
// All names and amounts made up.

const entry = (amount: number, category: 'equity' | 'loan', id = String(amount)): LedgerEntry => ({
  id, description: 'Test entry', amount, date: new Date(2026, 8, 15, 12), category,
});

describe('what counts as a cost', () => {
  it('a drawing is not a cost of the business; a salary is', () => {
    expect(isBusinessCost({ category: PARTNER_DRAWINGS })).toBe(false);
    expect(isBusinessCost({ category: PARTNER_SALARY })).toBe(true);
    expect(isBusinessCost({ category: 'Rent' })).toBe(true);
    expect(isBusinessCost({ category: null })).toBe(true);
    expect(isBusinessCost({})).toBe(true);
  });
});

describe('a partner\'s ledger', () => {
  it('sorts payments and withdrawals into equity and loan', () => {
    const l = categorise(
      [entry(100_000, 'equity'), entry(40_000, 'loan'), entry(25_000, 'equity')],
      [entry(10_000, 'equity'), entry(15_000, 'loan')],
    );
    expect(l).toEqual({ equityIn: 125_000, loanIn: 40_000, equityOut: 10_000, loanOut: 15_000 });
    expect(categorise([], [])).toEqual(emptyCategorisedLedger());
  });

  it('a claim is the loan, the equity and the half of profit and loss together', () => {
    const b = partnerBalance({ equityIn: 125_000, loanIn: 40_000, equityOut: 10_000, loanOut: 15_000 }, 60_000, 90_000);
    expect(b).toEqual({ equityBalance: 115_000, loanBalance: 25_000, netPnL: 30_000, totalClaim: 170_000 });
  });

  it('a loss is absorbed against the claim', () => {
    const b = partnerBalance({ equityIn: 50_000, loanIn: 0, equityOut: 0, loanOut: 0 }, 80_000, 20_000);
    expect(b).toEqual({ equityBalance: 50_000, loanBalance: 0, netPnL: -60_000, totalClaim: -10_000 });
  });
});

describe('the distribution waterfall', () => {
  const partners = [
    { name: 'Partner A', loanBalance: 30_000, equityBalance: 100_000, netPnL: 5000 },
    { name: 'Partner B', loanBalance: 10_000, equityBalance: 80_000, netPnL: 5000 },
  ];

  it('holds back the floor, repays the loans, then splits the rest equally', () => {
    const d = calculateDistribution(600_000, 500_000, partners);
    expect(d.distributableCash).toBe(100_000);
    expect(d.totalLoanOutstanding).toBe(40_000);
    expect(d.loanRepaymentsTotal).toBe(40_000);
    expect(d.profitPoolTotal).toBe(60_000);
    expect(d.perPartner).toEqual([
      { name: 'Partner A', loanRepayment: 30_000, profitShare: 30_000, equityDraw: 30_000, total: 60_000 },
      { name: 'Partner B', loanRepayment: 10_000, profitShare: 30_000, equityDraw: 30_000, total: 40_000 },
    ]);
    expect(d.remainingAfter).toBe(0);
    expect(d.feasible).toBe(true);
    expect(d.shortfallToFirstDistribution).toBe(0);
  });

  it('not enough for the loans: each is repaid in proportion, and nothing is split', () => {
    const d = calculateDistribution(520_000, 500_000, partners);
    expect(d.loanRepaymentsTotal).toBe(20_000);
    expect(d.perPartner.map(p => p.loanRepayment)).toEqual([15_000, 5000]);
    expect(d.profitPoolTotal).toBe(0);
    expect(d.perPartner.map(p => p.total)).toEqual([15_000, 5000]);
  });

  it('below the floor: nothing to give, and how far short it is', () => {
    const d = calculateDistribution(350_000, 500_000, partners);
    expect(d.distributableCash).toBe(0);
    expect(d.feasible).toBe(false);
    expect(d.shortfallToFirstDistribution).toBe(150_000);
    expect(d.perPartner.map(p => p.total)).toEqual([0, 0]);
  });

  it('a loan the business is owed back counts for nothing outstanding', () => {
    const d = calculateDistribution(100_000, 0, [
      { name: 'Partner A', loanBalance: -20_000, equityBalance: 0, netPnL: 0 },
      { name: 'Partner B', loanBalance: 0, equityBalance: 0, netPnL: 0 },
    ]);
    expect(d.totalLoanOutstanding).toBe(0);
    expect(d.loanRepaymentsTotal).toBe(0);
    expect(d.perPartner.map(p => p.profitShare)).toEqual([50_000, 50_000]);
  });

  it('ratios given for every partner split the pool by them', () => {
    const d = calculateDistribution(100_000, 0, [
      { name: 'Partner A', loanBalance: 0, equityBalance: 0, netPnL: 0 },
      { name: 'Partner B', loanBalance: 0, equityBalance: 0, netPnL: 0 },
    ], [3, 1]);
    expect(d.perPartner.map(p => p.profitShare)).toEqual([75_000, 25_000]);
    // A ratio list of the wrong length is ignored: equal shares.
    expect(calculateDistribution(100_000, 0, d.perPartner.map(p => ({ name: p.name, loanBalance: 0, equityBalance: 0, netPnL: 0 })), [1])
      .perPartner.map(p => p.profitShare)).toEqual([50_000, 50_000]);
  });
});

describe('the working-capital floor', () => {
  it('starts at five lac', () => {
    expect(DEFAULT_WORKING_CAPITAL_FLOOR).toBe(500_000);
  });

  it('is stale until it has been set this calendar month', () => {
    const now = new Date(2026, 9, 3, 12);
    expect(isFloorStale({ workingCapitalFloor: 1, floorHistory: [] }, now)).toBe(true);
    expect(isFloorStale({ workingCapitalFloor: 1, floorHistory: [], floorLastSetAt: 'never' }, now)).toBe(true);
    expect(isFloorStale({ workingCapitalFloor: 1, floorHistory: [], floorLastSetAt: new Date(2026, 8, 28, 12).toISOString() }, now)).toBe(true);
    expect(isFloorStale({ workingCapitalFloor: 1, floorHistory: [], floorLastSetAt: new Date(2025, 9, 2, 12).toISOString() }, now)).toBe(true);
    expect(isFloorStale({ workingCapitalFloor: 1, floorHistory: [], floorLastSetAt: new Date(2026, 9, 1, 12).toISOString() }, now)).toBe(false);
  });

  it('asks to be reviewed in the first five days of a month', () => {
    expect(isMonthStart(new Date(2026, 9, 1, 12))).toBe(true);
    expect(isMonthStart(new Date(2026, 9, 5, 12))).toBe(true);
    expect(isMonthStart(new Date(2026, 9, 6, 12))).toBe(false);
  });
});
