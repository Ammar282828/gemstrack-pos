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

describe('a fixed price with its weight (2026-10-07)', () => {
  const rate = 38538; // 10 g costs 361,293.75
  it('plain gold at a fixed price is costed from its gold', () => {
    const m = invoiceMargin({ items: [{ metalType: 'gold', karat: '21k', metalWeightG: 10, itemTotal: 400000, isCustomPrice: true }], subtotal: 400000, costRate24k: rate });
    expect(m.assumed).toBe(false);
    expect(m.costedShare).toBe(1);
    expect(m.cost).toBeCloseTo(361293.75, 2);
  });
  it('with diamonds or stones in the price, stays at 10% — their cost is written nowhere', () => {
    for (const extra of [{ hasDiamonds: true }, { diamondDetails: '0.5ct round' }, { stoneDetails: '4 rubies' }, { stoneWeightG: 0.4 }, { hasStones: true }]) {
      const m = invoiceMargin({ items: [{ metalType: 'gold', karat: '18k', metalWeightG: 4, itemTotal: 500000, isCustomPrice: true, ...extra }], subtotal: 500000, costRate24k: rate });
      expect(m.costedShare).toBe(0);
      expect(m.percent).toBeCloseTo(10, 6);
    }
  });
  it('a piece priced by weight with stones is still costed (its charges are on it)', () => {
    const m = invoiceMargin({ items: [{ metalType: 'gold', karat: '21k', metalWeightG: 10, itemTotal: 440000, stoneChargesIfAny: 50000, stoneDetails: '4 rubies' }], subtotal: 440000, costRate24k: rate });
    expect(m.costedShare).toBe(1);
  });
  it('an order at a fixed price with diamonds stays at 10%', () => {
    const m = orderMargin({ items: [{ metalType: 'gold', karat: '18k', estimatedWeightG: 4, isManualPrice: true, manualPrice: 500000, hasDiamonds: true }], costRate24k: rate });
    expect(m.costedShare).toBe(0);
  });
});
