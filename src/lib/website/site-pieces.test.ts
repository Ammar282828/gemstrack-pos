import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('@/lib/website/catalog-source', () => ({ getCatalogAttributes: async () => ({}) }));
vi.mock('@/lib/website/piece-weights', () => ({ getPieceWeights: async () => ({}) }));
vi.mock('@/lib/website/site-edits', () => ({ getSiteOverrides: async () => ({}), imagePathOf: () => null }));

const { withCounterWeight, withAngles } = await import('./site-pieces');
type SitePiece = import('./site-pieces').SitePiece;

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

describe('withAngles', () => {
  const piece = (id: string, extra: Partial<SitePiece> = {}) => ({ id, image: `https://t.shop/catalog-full/${id}`, thumb: `https://t.shop/catalog-thumb/${id}`, hidden: false, ...extra }) as SitePiece;
  it('lays a lead\'s angles on it, in file order, and leaves the rest alone', () => {
    const out = withAngles([piece('Sets/A 1.webp'), piece('Sets/A 1 back 10.webp'), piece('Sets/A 1 back 2.webp'), piece('Sets/B.webp')], {
      'Sets/A 1 back 10.webp': { angleOf: 'Sets/A 1.webp' }, 'Sets/A 1 back 2.webp': { angleOf: 'Sets/A 1.webp' },
    });
    expect(out[0].photos?.map(x => x.key)).toEqual(['Sets/A 1 back 2.webp', 'Sets/A 1 back 10.webp']);
    expect(out[0].photos?.[0].thumb).toBe('https://t.shop/catalog-thumb/Sets/A 1 back 2.webp');
    expect(out[3].photos).toBeUndefined();
  });
  it('skips hidden angles and angles of nothing', () => {
    const out = withAngles([piece('a'), piece('b', { hidden: true }), piece('c')], { b: { angleOf: 'a' }, c: { angleOf: 'zzz' } });
    expect(out[0].photos).toBeUndefined();
  });
});
