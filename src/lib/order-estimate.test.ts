import { describe, expect, it } from 'vitest';
import { orderEstimate, pricedOrderItems, type OrderFormItem } from './order-estimate';

// All made up.
const rates = { goldRatePerGram21k: 30_000, goldRatePerGram22k: 32_000, goldRatePerGram18k: 26_000, goldRatePerGram24k: 35_000,
  silverRatePerGram: 300, palladiumRatePerGram: 20_000, palladiumRatePerGram18k: 15_000, palladiumRatePerGram12k: 10_000 };
const piece = (over: Partial<OrderFormItem> = {}): OrderFormItem => ({
  description: 'Demo ring', karat: '21k', estimatedWeightG: 4, wastagePercentage: 10, makingCharges: 5_000,
  hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, isCompleted: false, metalType: 'gold', ...over,
} as OrderFormItem);

describe('an order estimate, as the form works it out', () => {
  it('prices by weight, takes the discount (never past the subtotal) and the advance with the exchange', () => {
    // 4 g × 30,000 = 120,000 + 10% wastage 12,000 + making 5,000 = 137,000
    const e = orderEstimate({ items: [piece()], discountAmount: 2_000, advancePayment: 30_000, advanceInExchangeValue: 5_000 }, rates);
    expect(e.subtotal).toBe(137_000);
    expect(e.discount).toBe(2_000);
    expect(e.grandTotal).toBe(137_000 - 2_000 - 30_000 - 5_000);
    expect(orderEstimate({ items: [piece()], discountAmount: 999_999 }, rates).discount).toBe(137_000);
  });

  it('silver is its all-in rate (no wastage, no making); a fixed price is its own; no weight is nothing yet', () => {
    const e = orderEstimate({ items: [
      piece({ metalType: 'silver', estimatedWeightG: 10, wastagePercentage: 25, makingCharges: 1_000 }),
      piece({ isManualPrice: true, manualPrice: 50_000 }),
      piece({ estimatedWeightG: 0 }),
    ] }, rates);
    expect(e.prices).toEqual([10 * 300, 50_000, 0]);
  });

  it('palladium keeps its karat when saved, so it is priced at that karat again later', () => {
    const [saved] = pricedOrderItems([piece({ metalType: 'palladium', karat: '18k', wastagePercentage: 0, makingCharges: 0 })], rates);
    expect(saved.karat).toBe('18k');
    expect(saved.totalEstimate).toBe(4 * 15_000);
    const [silver] = pricedOrderItems([piece({ metalType: 'silver', karat: '21k' })], rates);
    expect(silver.karat).toBeUndefined();
  });
});
