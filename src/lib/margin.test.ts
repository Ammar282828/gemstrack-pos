import { describe, expect, it } from 'vitest';
import { goldCostPerGram, invoiceMargin, marginOf, orderMargin, percentLabel } from './margin';

describe('what the shop earns', () => {
  it('costs a gram of jewellery at the 24k rate less 6 ratti (90/96)', () => {
    expect(goldCostPerGram(38538)).toBeCloseTo(36129.375, 3);
  });

  it('works out a sale from the 24k rate typed when it was made', () => {
    // 10 g of 21k at 34,000 + 10% wastage + 15,500 making = 389,500; cost 10 × 36,129.375.
    const m = invoiceMargin({
      items: [{ metalType: 'gold', karat: '21k', metalWeightG: 10, stoneWeightG: 0, quantity: 1, itemTotal: 389500 }],
      subtotal: 389500, discountAmount: 0, costRate24k: 38538,
    });
    expect(m.assumed).toBe(false);
    expect(m.cost).toBeCloseTo(361293.75, 2);
    expect(m.percent).toBeCloseTo(7.2417, 3);
    expect(percentLabel(m)).toBe('7.2%');
  });

  it('assumes 10% without a 24k rate — every sale recorded before', () => {
    const m = invoiceMargin({ items: [{ metalType: 'gold', metalWeightG: 10, itemTotal: 389500 }], subtotal: 389500 });
    expect(m.assumed).toBe(true);
    expect(m.percent).toBe(10);
    expect(m.profit).toBeCloseTo(38950, 6);
  });

  it('takes the discount off what was earned, and stones and diamonds at what they were charged', () => {
    const m = invoiceMargin({
      items: [{ metalType: 'gold', karat: '21k', metalWeightG: 10.5, stoneWeightG: 0.5, quantity: 1, itemTotal: 440000, stoneChargesIfAny: 50000 }],
      subtotal: 440000, discountAmount: 10000, costRate24k: 38538,
    });
    // Cost: 10 g × 36,129.375 + 50,000 stones = 411,293.75; worth 430,000.
    expect(m.cost).toBeCloseTo(411293.75, 2);
    expect(m.profit).toBeCloseTo(18706.25, 2);
  });

  it('takes a piece it cannot cost (no weight, not gold) at 10%, and says how much was costed', () => {
    const m = marginOf([
      { metalType: 'gold', karat: '21k', weightG: 10, price: 389500 },
      { metalType: 'gold', weightG: 0, price: 100000 },
    ], 489500, 38538);
    expect(m.cost).toBeCloseTo(361293.75 + 90000, 2);
    expect(m.costedShare).toBeCloseTo(389500 / 489500, 6);
  });

  it('prices an order from its agreed or estimated pieces, or the live figures on the form', () => {
    const order = {
      items: [{ metalType: 'gold', karat: '21k', estimatedWeightG: 10, stoneWeightG: 0, totalEstimate: 389500 }],
      subtotal: 389500, costRate24k: 38538,
    };
    expect(orderMargin(order).percent).toBeCloseTo(7.2417, 3);
    expect(orderMargin(order, [400000]).percent).toBeCloseTo((400000 - 361293.75) / 400000 * 100, 6);
    expect(orderMargin({ ...order, costRate24k: undefined }).percent).toBe(10);
  });
});
