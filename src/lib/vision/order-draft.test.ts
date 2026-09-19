import { describe, it, expect } from 'vitest';
import {
  reconcileSlip, exchangeValue, describeExchange, slipLinePrice, karatFor, metalFor,
} from './order-draft';

describe('slipLinePrice', () => {
  it('follows the slip: rate × weight, wastage on the metal, then making and stones', () => {
    // 10 g × 24,500 = 245,000; +10% = 24,500; making 8,000; stones 2,000 → 279,500
    expect(slipLinePrice({ weightG: 10, ratePerGram: 24500, wastagePercent: 10, makingCharges: 8000, stoneCharges: 2000 })).toBe(279500);
  });
  it('is null without a rate — a weight alone is not a price', () => {
    expect(slipLinePrice({ weightG: 10, makingCharges: 8000 })).toBeNull();
  });
});

describe('exchangeValue', () => {
  it('takes the written figure first', () => {
    expect(exchangeValue({ weightG: 5, ratePerGram: 20000, value: 95000 })).toEqual({ value: 95000, from: 'written' });
  });
  it('multiplies weight × rate when both were written against the old gold', () => {
    expect(exchangeValue({ weightG: 5.2, ratePerGram: 22000 })).toEqual({ value: 114400, from: 'computed' });
  });
  it('leaves a bare weight at zero rather than borrowing a rate', () => {
    expect(exchangeValue({ weightG: 5.2 })).toEqual({ value: 0, from: 'none' });
    expect(exchangeValue(null)).toEqual({ value: 0, from: 'none' });
  });
});

describe('describeExchange', () => {
  it('says where the value came from', () => {
    expect(describeExchange({ description: 'purana sona', karat: 21, weightG: 5.2, ratePerGram: 22000 }))
      .toBe('purana sona · 21k · 5.2 g · at 22,000/g · value is weight × rate off the slip');
    expect(describeExchange({ weightG: 5.2 }))
      .toBe('Gold taken in exchange · 5.2 g · no value written — enter what it was taken at');
  });
});

describe('karatFor / metalFor', () => {
  it('only passes a karat the form can take, per metal', () => {
    expect(karatFor({ karat: 21 }, 'gold')).toBe('21k');
    expect(karatFor({ karat: 20 }, 'gold')).toBeNull();
    expect(karatFor({ karat: 12, metalType: 'palladium' }, 'gold')).toBe('12k');
    expect(karatFor({ karat: 12 }, 'gold')).toBeNull();
    expect(karatFor({ karat: 21, metalType: 'silver' }, 'gold')).toBeNull();
  });
  it('falls back to the shop metal for anything it does not know', () => {
    expect(metalFor({ metalType: 'chandi' }, 'gold')).toBe('gold');
    expect(metalFor({ metalType: 'Silver' }, 'gold')).toBe('silver');
  });
});

describe('reconcileSlip', () => {
  it('is quiet when the slip agrees with itself', () => {
    const check = reconcileSlip({
      items: [{ description: 'Set', weightG: 20, ratePerGram: 24500, makingCharges: 10000, lineTotal: 500000 }],
      exchange: { weightG: 5, ratePerGram: 24000, value: 120000 },
      advancePayment: 50000,
      balanceDue: 330000,
    });
    expect(check.warnings).toEqual([]);
    expect(check.itemsOff).toEqual([]);
    expect(check.subtotal).toBe(500000);
    expect(check.balance).toBe(330000);
  });

  it('flags a piece whose written amount is not its own rate × weight', () => {
    const check = reconcileSlip({
      items: [{ description: 'Chain', weightG: 12.4, ratePerGram: 24500, makingCharges: 3500, lineTotal: 307300 }],
    });
    // 12.4 × 24,500 = 303,800 + 3,500 = 307,300 — fine. Now a misread 4 → 9:
    expect(check.warnings).toEqual([]);
    const off = reconcileSlip({
      items: [{ description: 'Chain', weightG: 12.9, ratePerGram: 24500, makingCharges: 3500, lineTotal: 307300 }],
    });
    expect(off.itemsOff).toEqual([0]);
    expect(off.warnings[0]).toMatch(/Chain: the slip writes 307,300 but its own rate × weight comes to 319,550/);
    // The written figure still stands in the subtotal — nothing is corrected.
    expect(off.subtotal).toBe(307300);
  });

  it('flags a balance that does not follow from the deductions', () => {
    const check = reconcileSlip({
      items: [{ description: 'Ring', lineTotal: 100000 }],
      exchange: { value: 30000 },
      advancePayment: 10000,
      discount: 5000,
      balanceDue: 60000, // should be 55,000
    });
    expect(check.balance).toBe(55000);
    expect(check.warnings).toHaveLength(1);
    expect(check.warnings[0]).toMatch(/balance is 60,000; total less what was taken off comes to 55,000/);
  });

  it('prefers the slip\'s own subtotal for the balance and says when the pieces disagree with it', () => {
    const check = reconcileSlip({
      items: [{ lineTotal: 100000 }, { lineTotal: 50000 }],
      subtotal: 180000, // a third line was missed
      balanceDue: 180000,
    });
    expect(check.warnings).toHaveLength(1);
    expect(check.warnings[0]).toMatch(/subtotal is 180,000; the pieces as read come to 150,000/);
    expect(check.balance).toBe(180000);
  });

  it('says so when old gold came without a figure', () => {
    const check = reconcileSlip({
      items: [{ weightG: 10, ratePerGram: 24500 }],
      exchange: { description: 'purana sona', weightG: 4 },
    });
    expect(check.warnings).toEqual([
      'Old gold was taken in exchange but the slip gives no figure for it. Its value is left for you to enter.',
    ]);
    expect(check.balance).toBe(245000);
  });

  it('has no balance to offer when nothing on the slip was priced', () => {
    const check = reconcileSlip({ items: [{ description: 'Ring', weightG: 5 }], advancePayment: 5000 });
    expect(check.balance).toBeNull();
    expect(check.warnings).toEqual([]);
  });
});
