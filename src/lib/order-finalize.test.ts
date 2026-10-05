import { describe, expect, it } from 'vitest';
import { finalizedItemCosts, orderInvoiceRates, wastageGramsFor, wastagePercentFor, type FinalizedItem } from './order-finalize';
import type { Order, OrderItem, Settings } from './store';

const rates = orderInvoiceRates({} as Pick<Order, 'ratesApplied'>, {
  goldRatePerGram24k: 0, goldRatePerGram22k: 0, goldRatePerGram21k: 34000, goldRatePerGram18k: 0,
  palladiumRatePerGram: 0, platinumRatePerGram: 0, silverRatePerGram: 300,
} as unknown as Settings);

const ring = {
  description: 'Ruby ring', metalType: 'gold', karat: '21k', estimatedWeightG: 6, stoneWeightG: 0, hasStones: false,
  wastagePercentage: 12, makingCharges: 10000, diamondCharges: 0, stoneCharges: 0, hasDiamonds: false,
  sampleGiven: false, isCompleted: true,
} as unknown as OrderItem;

const typed = (over: Partial<FinalizedItem> = {}): FinalizedItem => ({
  description: 'Ruby ring', metalType: 'gold', karat: '21k', finalWeightG: 6.5, finalWastagePercentage: 10,
  finalMakingCharges: 15000, finalDiamondCharges: 0, finalStoneCharges: 0, isManualPrice: false, ...over,
});

describe('Finalize & invoice, priced', () => {
  it('prices the piece at the wastage and making typed, not the order’s', () => {
    // 6.5 g × 34,000 = 221,000; 10% wastage 22,100; making 15,000.
    const c = finalizedItemCosts(ring, typed(), rates);
    expect(c.price).toBe(258100);
    expect(c.wastagePercentage).toBe(10);
    expect(c.makingCharges).toBe(15000);
  });

  it('keeps the order’s wastage when none is sent', () => {
    expect(finalizedItemCosts(ring, typed({ finalWastagePercentage: undefined }), rates).wastagePercentage).toBe(12);
  });

  it('counts a diamond charge typed here even if the order never ticked diamonds', () => {
    expect(finalizedItemCosts(ring, typed({ finalDiamondCharges: 50000 }), rates).price).toBe(308100);
  });

  it('takes a fixed price as it is', () => {
    expect(finalizedItemCosts(ring, typed({ isManualPrice: true, finalManualPrice: 99000 }), rates).price).toBe(99000);
  });

  it('turns the karigar’s grams into the percentage and back, on the metal less its stones', () => {
    expect(wastagePercentFor(0.65, 6.5)).toBe(10);
    expect(wastageGramsFor(10, 6.5)).toBeCloseTo(0.65, 6);
    expect(wastagePercentFor(0.62, 6.5, 0.3)).toBe(10);
    expect(wastagePercentFor(0.5, 0)).toBe(0);
    expect(wastageGramsFor(wastagePercentFor(0.65, 6.37), 6.37)).toBeCloseTo(0.65, 6);
    // 2 g typed on 20.3 g at 35,000/g is 70,000 of wastage, to the rupee.
    expect(Math.round(20.3 * 35000 * wastagePercentFor(2, 20.3) / 100)).toBe(70000);
  });
});
