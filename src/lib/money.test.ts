import { describe, expect, it } from 'vitest';
import { isCredit, owesMoney, pkr, rupeeText, rupees, rupeesIn, wholeRupeesFromText } from './money';
import { _calculateProductCostsInternal } from './pricing';
import { balanceLine } from './invoice-credit';
import { isOwing, owedToYou } from './owed';

describe('whole rupees', () => {
  it('rounds halves up, never leaves -0 or NaN', () => {
    expect(rupees(297000.5)).toBe(297001);
    expect(rupees(297000.49)).toBe(297000);
    expect(rupees(-0.2)).toBe(0);
    expect(Object.is(rupees(-0.2), 0)).toBe(true);
    expect(rupees('12,500')).toBe(0); // text is read by wholeRupeesFromText
    expect(rupees(undefined)).toBe(0);
    expect(rupees(NaN)).toBe(0);
  });
  it('reads typed text', () => {
    expect(wholeRupeesFromText('12,500.75')).toBe(12501);
  });
  it('shows no decimals', () => {
    expect(pkr(297000)).toBe('PKR 297,000');
    expect(pkr(297000.4)).toBe('PKR 297,000');
    expect(rupeeText(1234567.8)).toBe('1,234,568');
  });
  it('rounds only the money fields that are there', () => {
    expect(rupeesIn({ a: 1.6, b: undefined, c: '' }, ['a', 'b', 'c'])).toEqual({ a: 2 });
  });
});

describe('settled under a rupee', () => {
  it('a fraction left from before is not a debt or a credit', () => {
    expect(owesMoney(0.7)).toBe(false);
    expect(owesMoney(1)).toBe(true);
    expect(owesMoney(-0.7)).toBe(false);
    expect(isCredit(-0.7)).toBe(false);
    expect(isCredit(-1)).toBe(true);
    expect(balanceLine(0.99).state).toBe('paid');
    expect(balanceLine(1).state).toBe('due');
    expect(balanceLine(-0.99).state).toBe('paid');
    expect(balanceLine(-1).state).toBe('credit');
  });
  it('Due to customers leaves out a sub-rupee remainder', () => {
    expect(isOwing({ id: 'A', balanceDue: 0.7 })).toBe(false);
    expect(isOwing({ id: 'B', balanceDue: 1.2 })).toBe(true);
    const o = owedToYou([{ id: 'A', balanceDue: 0.7 }, { id: 'B', balanceDue: 1500, customerId: 'c1' }]);
    expect(o.total).toBe(1500);
    expect(o.invoices.map((i) => i.id)).toEqual(['B']);
  });
});

describe('a piece prices in whole rupees that add up', () => {
  const rates = { goldRatePerGram24k: 0, goldRatePerGram22k: 0, goldRatePerGram21k: 28_333.33, goldRatePerGram18k: 0, palladiumRatePerGram: 0, platinumRatePerGram: 0, silverRatePerGram: 0 };
  const piece = {
    metalType: 'gold' as const, karat: '21k', metalWeightG: 7.337, stoneWeightG: 0.211, wastagePercentage: 9.5,
    makingCharges: 12_345.67, hasDiamonds: true, diamondCharges: 5_000.5, stoneCharges: 1_999.49, miscCharges: 0,
  };
  it('every line and the total are integers, and the lines sum to the total', () => {
    const c = _calculateProductCostsInternal(piece, rates);
    for (const v of Object.values(c)) expect(Number.isInteger(v)).toBe(true);
    expect(c.metalCost + c.wastageCost + c.makingCharges + c.diamondCharges + c.stoneCharges + c.miscCharges).toBe(c.totalPrice);
  });
  it('silver and a fixed price too', () => {
    const s = _calculateProductCostsInternal({ ...piece, metalType: 'silver', karat: undefined }, { ...rates, silverRatePerGram: 187.55 });
    for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true);
    expect(_calculateProductCostsInternal({ ...piece, isCustomPrice: true, customPrice: 99_999.6 }, rates).totalPrice).toBe(100_000);
  });
});
