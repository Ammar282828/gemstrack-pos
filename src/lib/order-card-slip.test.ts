import { describe, expect, it } from 'vitest';
import { cardAdvance, cardItems, cardRates, drawCardOrderSlip } from './order-card-slip';

const item = (o: Record<string, unknown> = {}) => ({
  description: 'Bypass ring', metalType: 'gold', karat: '21k', estimatedWeightG: 6.4, stoneWeightG: 0, hasStones: false, wastagePercentage: 0,
  makingCharges: 0, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, isCompleted: false, itemCategory: 'cat001', ...o,
});
const order = (o: Record<string, unknown> = {}) => ({
  id: 'ORD-1', createdAt: '2026-11-10T10:00:00Z', customerName: 'A', items: [item()], subtotal: 100000, discountAmount: 0, grandTotal: 80000,
  advancePayment: 20000, ratesApplied: { goldRatePerGram21k: 34000 }, ...o,
}) as never;

describe('the card order slip', () => {
  it('writes the rate of each karat in the order, and none when the rates are hidden', () => {
    expect(cardRates(order())).toBe('21K · PKR 34,000/g');
    expect(cardRates(order({ hideRates: true }))).toBe('');
  });
  it('writes the advance, and gold taken in exchange beside it', () => {
    expect(cardAdvance(order())).toBe('PKR 20,000');
    expect(cardAdvance(order({ advanceInExchangeValue: 15000 }))).toBe('PKR 20,000 + PKR 15,000 in exchange');
  });
  it('gives a line per piece and fits on one A5 page however many pieces', () => {
    expect(cardItems(order())[0]).toMatch(/Bypass ring/);
    const doc = drawCardOrderSlip(order({ items: Array.from({ length: 12 }, () => item()) }));
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
