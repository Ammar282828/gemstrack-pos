import { describe, expect, it } from 'vitest';
import { placedOnline, takenByProblem, TAKEN_BY_MISSING } from './taken-by';

describe('Taken by is required', () => {
  it('refuses a blank name', () => {
    expect(takenByProblem(undefined)).toBe(TAKEN_BY_MISSING);
    expect(takenByProblem('')).toBe(TAKEN_BY_MISSING);
    expect(takenByProblem('   ')).toBe(TAKEN_BY_MISSING);
    expect(takenByProblem(42)).toBe(TAKEN_BY_MISSING);
  });
  it('accepts any name (the list is the screens\' check)', () => {
    expect(takenByProblem('Ammar')).toBeNull();
    expect(takenByProblem('Someone who left')).toBeNull();
  });
  it('lets an order the customer placed online stay without one', () => {
    expect(placedOnline({ id: 'SHOPIFY-1042' })).toBe(true);
    expect(placedOnline({ id: 'ORD-0001', shopifyOrderName: '#1042' })).toBe(true);
    expect(placedOnline({ id: 'ORD-0002', website: { ref: 'x' } })).toBe(true);
    expect(placedOnline({ id: 'ORD-0003', shopifyOrderId: '123' })).toBe(false); // a counter order carried to Shopify
    expect(takenByProblem('', { id: 'SHOPIFY-1042' })).toBeNull();
    expect(takenByProblem('', { id: 'ORD-0003' })).toBe(TAKEN_BY_MISSING);
  });
});
