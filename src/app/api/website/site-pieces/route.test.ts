import { describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { NextRequest } from 'next/server';

const pieces = Array.from({ length: 40 }, (_, i) => ({ id: `mina/piece/p${i}`, name: `Piece ${i} with a long enough name`, url: `https://c.store/p${i}`, image: `https://c.store/full/${i}.webp`, thumb: `https://c.store/thumb/${i}.webp`, collection: 'Bangles', hidden: false, change: null, own: { name: 'x', about: 'y'.repeat(50), facts: [] }, words: { name: 'x', about: 'y'.repeat(50), facts: [] } }));
vi.mock('@/lib/social/gate', () => ({ postGate: async () => 'counter' }));
vi.mock('@/lib/store-config', () => ({ STORE_SITE_POSTS: true }));
vi.mock('@/lib/website/site-pieces', async () => {
  const real = await vi.importActual<typeof import('@/lib/website/site-pieces')>('@/lib/website/site-pieces').catch(() => null);
  return { getSitePieces: async () => ({ site: 'https://c.store', pieces }), lastPosted: async () => ({}), leanPiece: real?.leanPiece ?? (({ own, words, change, ...r }: any) => r) };
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));

const { GET } = await import('./route');
const call = (url: string, enc?: string) => GET(new NextRequest(url, { headers: enc ? { 'accept-encoding': enc } : {} }));

describe('GET /api/website/site-pieces', () => {
  it('sends the whole piece by default, plain without Accept-Encoding', async () => {
    const r = await call('http://x/api/website/site-pieces');
    expect(r.headers.get('content-encoding')).toBeNull();
    const j = await r.json();
    expect(j.pieces[0].own).toBeDefined();
    expect(j.pieces[0].words).toBeDefined();
  });
  it('?lean=1 leaves off own, words and an empty change', async () => {
    const j = await (await call('http://x/api/website/site-pieces?lean=1')).json();
    expect(j.pieces).toHaveLength(40);
    expect(j.pieces[0].own).toBeUndefined();
    expect(j.pieces[0].words).toBeUndefined();
    expect('change' in j.pieces[0]).toBe(false);
    expect(j.pieces[0].thumb).toBe('https://c.store/thumb/0.webp');
  });
  it('gzips when the caller accepts it, and the body reads back the same', async () => {
    const plain = await (await call('http://x/api/website/site-pieces?lean=1')).text();
    const r = await call('http://x/api/website/site-pieces?lean=1', 'gzip, deflate, br');
    expect(r.headers.get('content-encoding')).toBe('gzip');
    expect(r.headers.get('vary')).toMatch(/Accept-Encoding/i);
    const raw = Buffer.from(await r.arrayBuffer());
    expect(raw.length).toBeLessThan(plain.length);
    expect(gunzipSync(raw).toString()).toBe(plain);
  });
});
