import { describe, expect, it } from 'vitest';
import { buildOrderItemBlocks } from './order-slip';
import type { Order, OrderItem } from '@/lib/store';

const piece = (o: Partial<OrderItem>): OrderItem => ({
  description: 'Ring', karat: '21k', estimatedWeightG: 10, stoneWeightG: 0, hasStones: false, wastagePercentage: 10,
  makingCharges: 0, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, isCompleted: false, hasDiamonds: false,
  metalType: 'gold', ...o,
} as OrderItem);
const spec = (o: Partial<OrderItem>) => buildOrderItemBlocks({ items: [piece(o)] } as unknown as Order)[0].spec;

describe('the workshop slip writes wastage in grams, as the bill does', () => {
  it('the estimated weight less stones × the percentage, never the percentage', () => {
    expect(spec({})).toContain('Wastage 1.00g');
    expect(spec({ estimatedWeightG: 12.5, stoneWeightG: 2.5, wastagePercentage: 8 })).toContain('Wastage 0.80g');
    expect(spec({ wastagePercentage: 12.5 })).not.toMatch(/%/);
  });
  it('says nothing where there is no wastage, or on silver', () => {
    expect(spec({ wastagePercentage: 0 })).not.toContain('Wastage');
    expect(spec({ metalType: 'silver' })).not.toContain('Wastage');
  });
});
