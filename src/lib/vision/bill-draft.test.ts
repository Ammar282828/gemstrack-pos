import { describe, expect, it } from 'vitest';
import { billLineToProduct, billRates, type BillLine } from './bill-draft';
import { _calculateProductCostsInternal } from '@/lib/pricing';

// Taheri's estimate of 2026-09-29 for two rings, as the scanner should read it.
const blue: BillLine = { description: 'Blue Ring', weightG: 6.3, wastageG: 0.63, ratePerGram: 34000, stoneCharges: 20000, makingCharges: 6000, lineTotal: 261620 };
const opal: BillLine = { description: 'Opal Ring', weightG: 5.7, stoneWeightG: 0.5, wastageG: 0.52, stoneCharges: 48500, makingCharges: 6000, lineTotal: 248980 };
const blank = { name: '', categoryId: '', metalType: 'gold', metalWeightG: 0, karat: '21k', hasStones: false, stoneWeightG: 0, wastagePercentage: 10, makingCharges: 0, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, isCustomPrice: false, customPrice: 0 };
const rates = { goldRatePerGram24k: 0, goldRatePerGram22k: 0, goldRatePerGram21k: 34000, goldRatePerGram18k: 0, palladiumRatePerGram: 0, platinumRatePerGram: 0, silverRatePerGram: 0 };

describe('a written bill into the cart', () => {
  it('prices each line to the paper’s own figure at the paper’s rate and wastage', () => {
    for (const l of [blue, opal]) {
      const p = billLineToProduct(l, blank, 'gold') as unknown as Parameters<typeof _calculateProductCostsInternal>[0];
      expect(p.wastagePercentage).toBe(10);
      expect(Math.round(_calculateProductCostsInternal(p, rates).totalPrice)).toBe(l.lineTotal);
    }
  });
  it('keeps the house wastage when the bill wrote none', () => {
    expect((billLineToProduct({ weightG: 4 }, blank, 'gold') as { wastagePercentage: number }).wastagePercentage).toBe(10);
  });
  it('the rate written once at the top sets the 21k box', () => {
    expect(billRates([blue, opal], 34000, 'gold')).toEqual({ gold21k: 34000 });
    expect(billRates([{ ...blue, karat: 22, ratePerGram: 36000 }, opal], 34000, 'gold')).toEqual({ gold22k: 36000, gold21k: 34000 });
  });
  it('no rate, a bare line, silver, or one karat at two rates sets nothing', () => {
    expect(billRates([{ weightG: 5 }], null, 'gold')).toEqual({});
    expect(billRates([{ lineTotal: 45000 }], 34000, 'gold')).toEqual({});
    expect(billRates([{ weightG: 50 }], 250, 'silver')).toEqual({});
    expect(billRates([{ ...blue, ratePerGram: 34000 }, { ...opal, ratePerGram: 35000 }], null, 'gold')).toEqual({});
  });
});
