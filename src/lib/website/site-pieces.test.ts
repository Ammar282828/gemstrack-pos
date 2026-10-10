import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('@/lib/website/catalog-source', () => ({ getCatalogAttributes: async () => ({}) }));
vi.mock('@/lib/website/piece-weights', () => ({ getPieceWeights: async () => ({}) }));
vi.mock('@/lib/website/site-edits', () => ({ getSiteOverrides: async () => ({}), imagePathOf: () => null }));

const { withCounterWeight } = await import('./site-pieces');

const piece = (over: Record<string, unknown> = {}) => ({
  id: 'Rings & Bands/Rings/DSC09900.webp', name: 'DSC09900', url: '', image: '', thumb: '', collection: 'Rings', weightGrams: null,
  weightOnPhoto: false, facts: [], about: '', added: null, newArrival: false, imagePath: null, source: 'attributes' as const,
  photoSource: null, sourceMarked: false, own: { name: '', about: '', facts: [] }, labelGrams: null, ...over,
});

describe('withCounterWeight', () => {
  it('gives a new upload the weight typed at the counter', () => {
    expect(withCounterWeight(piece({ drop: true }), { 'Rings & Bands/Rings/DSC09900.webp': { weightGrams: 4.2 } }).weightGrams).toBe(4.2);
  });

  it('takes the counter\'s over the label, and the label when the counter has none', () => {
    expect(withCounterWeight(piece({ labelGrams: 3.9 }), { 'Rings & Bands/Rings/DSC09900.webp': { weightGrams: 4.2 } }).weightGrams).toBe(4.2);
    expect(withCounterWeight(piece({ labelGrams: 3.9, weightGrams: 4.2 }), {}).weightGrams).toBe(3.9);
    expect(withCounterWeight(piece(), {}).weightGrams).toBeNull();
  });

  it('leaves the catalogue\'s pieces (House of Mina) as they are', () => {
    expect(withCounterWeight(piece({ source: 'pieces', weightGrams: 5 }), { 'Rings & Bands/Rings/DSC09900.webp': { weightGrams: 4.2 } }).weightGrams).toBe(5);
  });
});
