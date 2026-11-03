import { describe, expect, it } from 'vitest';
import { buildKarigarMessage, buildPhotoCaption, chooseKarigarPieces, firstName, maskPhone } from './karigar-message';
import type { Order, OrderItem } from '@/lib/store';

const piece = (o: Partial<OrderItem>): OrderItem => ({
  description: 'Ring with a flat top', itemCategory: 'rings', karat: '21k', estimatedWeightG: 10, stoneWeightG: 0, hasStones: false, wastagePercentage: 10,
  makingCharges: 4321, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, isCompleted: false, hasDiamonds: false,
  metalType: 'gold', totalEstimate: 987654, size: '9', adminNote: 'Deepen the engraving', ...o,
} as OrderItem);
const order = (items: OrderItem[]): Order => ({
  id: 'ORD-000042', items, customerName: 'Ayesha Khan', customerPhone: '0300 1234567', promisedDate: '2026-11-20',
  subtotal: 987654, grandTotal: 500000, advancePayment: 487654, ratesApplied: { goldRatePerGram21k: 33333 },
} as unknown as Order);

describe('the message to a karigar', () => {
  const msg = buildKarigarMessage(
    order([piece({ stoneDetails: '3 rubies', stoneWeightG: 0.4 }), piece({ description: 'Pendant', size: '' })]),
    [0, 1], { karigarName: 'Usman Ali', photoCount: 2 });
  it('carries only the order number and each piece: name, description, size, stones and instructions', () => {
    expect(msg).toContain('Order ORD-000042');
    expect(msg).toContain('*Ring with a flat top*');
    expect(msg).toContain('Metal: Gold (21K)');
    expect(msg).toContain('Weight: 10g');
    expect(msg).toContain('Size: 9');
    expect(msg).toContain('Stones: 3 rubies');
    expect(msg).toContain('Stone weight: 0.40g');
    expect(msg).toContain('Instructions: Deepen the engraving');
  });
  it('never carries wastage, a due date, a greeting, a price, a rate, a phone or the customer', () => {
    expect(msg).not.toMatch(/Wastage|Due|Assalam|For:|Ayesha|PKR|987|4321|33333|487654|500000|0300|Khan/i);
  });
  it('writes a one-piece order without numbering', () => {
    expect(buildKarigarMessage(order([piece({})]), [0])).not.toMatch(/^1\. /m);
  });
  it('captions a photo with the same details, within the limit', () => {
    const cap = buildPhotoCaption(order([piece({})]), 0);
    expect(cap).toContain('Size: 9');
    expect(cap).not.toMatch(/Wastage/);
    expect(cap.length).toBeLessThanOrEqual(1000);
  });
});

describe('helpers', () => {
  it('chooses pieces that exist, once, in order; all when none are named', () => {
    const o = order([piece({}), piece({}), piece({})]);
    expect(chooseKarigarPieces(o, [2, 0, 2, 9, -1])).toEqual([0, 2]);
    expect(chooseKarigarPieces(o, [])).toEqual([0, 1, 2]);
    expect(chooseKarigarPieces(o)).toEqual([0, 1, 2]);
  });
  it('first names and masked numbers', () => {
    expect(firstName('  Ayesha  Khan ')).toBe('Ayesha');
    expect(firstName(undefined)).toBe('');
    expect(maskPhone('923001234567')).toBe('+92•••••••567');
  });
});
