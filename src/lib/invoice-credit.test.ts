import { describe, expect, it } from 'vitest';
import { balanceLine, canHoldCredit, creditDescription, inCredit, isCreditRow } from './invoice-credit';

describe('an invoice in credit', () => {
  it('reads as due, paid or credit, with paise either way counted as settled', () => {
    expect(balanceLine(5_000)).toEqual({ label: 'Balance due', amount: 5_000, state: 'due' });
    expect(balanceLine(-5_000)).toEqual({ label: 'Credit to customer', amount: 5_000, state: 'credit' });
    expect(balanceLine(0.3).state).toBe('paid');
    expect(balanceLine(-0.3).state).toBe('paid');
    expect(balanceLine(undefined).state).toBe('paid');
    expect(inCredit(-1)).toBe(true);
    expect(inCredit(-0.4)).toBe(false);
  });

  it('is held only for someone named', () => {
    expect(canHoldCredit('c1')).toBe(true);
    expect(canHoldCredit('walk-in')).toBe(false);
    expect(canHoldCredit('')).toBe(false);
    expect(canHoldCredit(undefined)).toBe(false);
  });

  it('knows its ledger row, and the one the sync used to write', () => {
    expect(isCreditRow({ description: creditDescription('INV-1'), cashCredit: 5 }, 'INV-1')).toBe(true);
    expect(isCreditRow({ description: 'Excess advance returned for Invoice INV-1', cashCredit: 5 }, 'INV-1')).toBe(true);
    expect(isCreditRow({ description: creditDescription('INV-2'), cashCredit: 5 }, 'INV-1')).toBe(false);
    expect(isCreditRow({ description: 'Outstanding balance for Invoice INV-1', cashDebit: 5 }, 'INV-1')).toBe(false);
  });
});
