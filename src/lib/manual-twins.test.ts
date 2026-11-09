import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
import { handTotalForMonth, twinOf, type HandExpense } from './manual-twins';

const list: HandExpense[] = [
  { id: 'a1', date: '2026-10-03T10:00:00Z', amount: 8200, description: 'Shopify monthly', category: 'Marketing' },
  { id: 'a2', date: '2026-10-05T10:00:00Z', amount: 8200, description: 'Rent' },
  { id: 'shopify-bill-123', date: '2026-10-03T10:00:00Z', amount: 8150, description: 'Shopify bill #123', source: 'shopify-bill' },
  { id: 'b1', date: '2026-10-12T10:00:00Z', amount: 900, description: 'Safepay charges' },
  { id: 'b2', date: '2026-11-01T10:00:00Z', amount: 500, description: 'safepay' },
];

describe('bills already recorded by hand', () => {
  it('finds the hand-made Shopify expense near the bill', () => {
    expect(twinOf(list, { date: '2026-10-01T00:00:00Z', amount: 8150 }, /shopify/i, new Set())?.id).toBe('a1');
  });
  it('ignores the import’s own rows, other vendors, far dates, other amounts and ones already used', () => {
    expect(twinOf(list, { date: '2026-12-01T00:00:00Z', amount: 8150 }, /shopify/i, new Set())).toBeNull();
    expect(twinOf(list, { date: '2026-10-01T00:00:00Z', amount: 12000 }, /shopify/i, new Set())).toBeNull();
    expect(twinOf(list, { date: '2026-10-01T00:00:00Z', amount: 8150 }, /shopify/i, new Set(['a1']))).toBeNull();
  });
  it('sums a month of hand-made fees for a vendor', () => {
    expect(handTotalForMonth(list, '2026-10', /safepay/i)).toBe(900);
    expect(handTotalForMonth(list, '2026-11', /safepay/i)).toBe(500);
    expect(handTotalForMonth(list, '2026-10', /\btcs\b/i)).toBe(0);
  });
});
