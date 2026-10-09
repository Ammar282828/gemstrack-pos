import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Made-up photographs and weights.
const saved: { key: string; grams: number | null; by: string }[] = [];
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: vi.fn(async () => 'owner@example.com') }));
vi.mock('@/lib/roles', () => ({ roleForEmail: () => 'owner' }));
vi.mock('@/lib/website/catalog-source', () => ({
  normalisePieceKey: (k: string) => k,
  getCatalogAttributes: vi.fn(async () => ({
    'Rings & Bands/Rings/Ring 1.webp': { added: 1_758_000_000 },          // seconds: Sep 2025
    'Rings & Bands/Rings/Ring 2.webp': { added: 1_790_000_000_000 },      // ms: Sep 2026
    'Sets/Gold Sets/Gold Set 9.webp': {},                                  // undated
  })),
}));
vi.mock('@/lib/website/weights', () => ({
  getPosWeights: vi.fn(async () => ({ 'Rings & Bands/Rings/DSC1.webp': { key: 'Rings & Bands/Rings/DSC1.webp', weightGrams: 3.2, enteredBy: 'x', enteredAt: 't' } })),
  mergeWeights: (catalog: Record<string, object>) => Object.fromEntries(Object.entries(catalog).map(([k, a]) => [k, { ...a, weightGrams: null, weightSource: null }])),
  setPosWeight: vi.fn(async (key: string, grams: number | null, by: string) => { saved.push({ key, grams, by }); }),
}));
vi.mock('@/lib/website/site-pieces', () => ({
  listDrops: vi.fn(async () => [
    { key: 'Rings & Bands/Rings/DSC1.webp', name: 'DSC1', thumb: 'https://shop.example/t/DSC1.jpg', added: 1_791_000_000_000 },
    { key: 'Rings & Bands/Rings/DSC2.webp', name: 'DSC2', thumb: 'https://shop.example/t/DSC2.jpg', added: 1_791_500_000_000 },
  ]),
}));
vi.mock('@/lib/website/pricing', () => ({ collectionOfKey: (k: string) => k.split('/').slice(0, 2).join('/') }));

const { GET, PUT } = await import('./route');
const req = (body?: unknown) => new NextRequest('https://erp.example/api/website/pieces', body === undefined ? {} : { method: 'PUT', body: JSON.stringify(body) });

beforeEach(() => { saved.length = 0; });

describe('GET', () => {
  it('lists the new uploads with the listed photographs, newest first, the undated last', async () => {
    const d = await (await GET(req())).json();
    expect(d.pieces.map((p: { key: string }) => p.key)).toEqual([
      'Rings & Bands/Rings/DSC2.webp',
      'Rings & Bands/Rings/DSC1.webp',
      'Rings & Bands/Rings/Ring 2.webp',
      'Rings & Bands/Rings/Ring 1.webp',
      'Sets/Gold Sets/Gold Set 9.webp',
    ]);
    const dsc1 = d.pieces.find((p: { key: string }) => p.key.endsWith('DSC1.webp'));
    expect(dsc1).toMatchObject({ drop: true, file: 'DSC1', weightGrams: 3.2, source: 'pos', thumb: 'https://shop.example/t/DSC1.jpg' });
    expect(d.pieces.find((p: { key: string }) => p.key.endsWith('Ring 1.webp')).added).toBe(1_758_000_000_000);
    expect(d.total).toBe(5);
  });
});

describe('PUT', () => {
  it('takes a weight for a listed photograph and for a new upload, and refuses one the site has not got', async () => {
    expect((await PUT(req({ key: 'Rings & Bands/Rings/Ring 1.webp', weightGrams: 4.1 }))).status).toBe(200);
    expect((await PUT(req({ key: 'Rings & Bands/Rings/DSC2.webp', weightGrams: 2.75 }))).status).toBe(200);
    expect((await PUT(req({ key: 'Rings & Bands/Rings/Nope.webp', weightGrams: 2 }))).status).toBe(404);
    expect(saved).toEqual([
      { key: 'Rings & Bands/Rings/Ring 1.webp', grams: 4.1, by: 'owner@example.com' },
      { key: 'Rings & Bands/Rings/DSC2.webp', grams: 2.75, by: 'owner@example.com' },
    ]);
  });
});
