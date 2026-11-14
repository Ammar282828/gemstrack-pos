import { describe, expect, it } from 'vitest';
import { buildOrderItemBlocks } from './order-slip';
import type { Order, OrderItem } from '@/lib/store';

const piece = (o: Partial<OrderItem>): OrderItem => ({
  description: 'Ring', karat: '21k', estimatedWeightG: 10, stoneWeightG: 0, hasStones: false, wastagePercentage: 10,
  makingCharges: 0, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, isCompleted: false, hasDiamonds: false,
  metalType: 'gold', ...o,
} as OrderItem);
const spec = (o: Partial<OrderItem>) => buildOrderItemBlocks({ items: [piece(o)] } as unknown as Order)[0].spec;

describe('the order slip never writes wastage (only the final bill does)', () => {
  it('leaves wastage off, in grams or percent, while keeping the estimated weight', () => {
    expect(spec({})).not.toMatch(/wastage|%/i);
    expect(spec({ estimatedWeightG: 12.5, stoneWeightG: 2.5, wastagePercentage: 8 })).toContain('Est. 12.5g');
    expect(spec({ metalType: 'silver' })).not.toMatch(/wastage/i);
  });
});
