import { describe, expect, it } from 'vitest';
import { catalogSets } from './catalog-sets';

describe('catalogSets', () => {
  it('drops Meta’s auto-made and page-address sets, biggest first', () => {
    const out = catalogSets([
      { id: '1', name: 'Similar Items for Vera Product [Auto-Created Set]', product_count: 2 },
      { id: '2', name: 'Set for url https://houseofmina.store/search', product_count: 38 },
      { id: '3', name: 'Pearl', product_count: 21 },
      { id: '4', name: 'HoM 2026-10 · Everything except moissanite (163)', product_count: 162 },
      { id: '5', name: 'Unknown size' },
    ]);
    expect(out.map(s => s.id)).toEqual(['4', '3', '5']);
    expect(out[2].products).toBeNull();
  });
});
