import { describe, expect, it } from 'vitest';
import { cardAdvance, cardItems, cardRates, drawCardOrderSlip } from './order-card-slip';
import { envelopeLines } from './order-envelope';

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
    // The card is one A5 page however many pieces (the envelope's sheet is added by order-slip-pdf.ts, after either slip).
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('the envelope sheet carries the money and every piece in full', () => {
    const o = order({ customerContact: '+923001234567', notes: 'Polish before handing over', items: [item({ description: 'Meena Jhumki', size: '7', stoneDetails: 'Rubies, pear', sampleGiven: true, totalEstimate: 208788 })] } as never);
    const e = envelopeLines(o, d => d.slice(0, 10));
    expect(e.head).toContain('+923001234567');
    expect(e.money.join(' | ')).toMatch(/Estimate PKR .*\| Advance PKR 20,000 .*Balance PKR/);
    expect(e.money.join(' | ')).toMatch(/Rate 21K · PKR/);
    const all = [e.pieces[0].title, ...e.pieces[0].lines].join(' | ');
    expect(e.pieces[0].title).toMatch(/^1\. /);
    for (const want of [/Meena Jhumki/, /Size 7/, /Stones: Rubies, pear/, /Est\. PKR 208,788/, /Sample given/]) expect(all).toMatch(want);
    expect(e.notes).toBe('Polish before handing over');
  });
});
