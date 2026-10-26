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

// House of Mina's catalogue (catalogue.houseofmina.store/catalog-pieces.json): the shape it publishes, public piece data only.
const minaFile = {
  site: 'https://catalogue.houseofmina.store',
  pieces: [
    { id: 'mina/piece/local-dsc09808', name: 'Tri-Tone Scattered Stone Bangles', path: '/bangles-and-cuffs/tri-tone-scattered-stone-bangles',
      image: '/catalog-full/local/DSC09808.webp?v=1', thumb: '/catalog-thumb/local/DSC09808.webp?v=1',
      images: [{ image: '/catalog-full/local/DSC09808.webp?v=1', thumb: '/catalog-thumb/local/DSC09808.webp?v=1' }, { image: '/catalog-full/local/DSC09809.webp?v=1', thumb: '/catalog-thumb/local/DSC09809.webp?v=1' }],
      collection: 'Bangles & Cuffs', stones: ['Cubic zirconia'], plating: ['Rhodium', 'Gold'], about: 'Three tones. ', story: [], facts: [],
      source: '/catalog-src/local/DSC09808.jpg', added: '2026-10-24', newArrival: true },
    { id: 'mina/piece/local-dsc09787-sq', name: 'Hexagon Link Bangles', path: '/bangles-and-cuffs/hexagon-link-bangles', image: '/catalog-full/local/DSC09787-sq.webp?v=1',
      thumb: '/catalog-thumb/local/DSC09787-sq.webp?v=1', collection: 'Bangles & Cuffs', stones: [], plating: [], about: '', story: ['One.', 'Two.'], facts: ['Adjustable'],
      source: '', added: '2026-10-22', marked: true },
    // Odd rows: wrong types and missing parts must cost only themselves.
    { id: 'mina/piece/odd', name: 'Odd', path: '/x/odd', image: '/catalog-full/odd.webp', stones: 'Ruby', plating: null, story: 'text', images: 'none', added: 42 },
    { id: 'mina/piece/no-page', name: 'No page', image: '/catalog-full/np.webp' },
    null,
  ],
};
const { parseCatalogPieces, getSitePieces, forgetSitePieces } = await import('./site-pieces');

describe('parseCatalogPieces (Mina-shaped catalogue)', () => {
  const out = parseCatalogPieces('https://catalogue.houseofmina.store', minaFile as never);
  it('lists the pieces that have a page, absolute, and drops the rest', () => {
    expect(out.map(p => p.id)).toEqual(['mina/piece/local-dsc09808', 'mina/piece/local-dsc09787-sq', 'mina/piece/odd']);
    expect(out[0].url).toBe('https://catalogue.houseofmina.store/bangles-and-cuffs/tri-tone-scattered-stone-bangles');
    expect(out[0].thumb).toBe('https://catalogue.houseofmina.store/catalog-thumb/local/DSC09808.webp?v=1');
    expect(out[0].facts).toEqual(['Cubic zirconia', 'rhodium or gold plated']);
    expect(out[0].photos?.map(x => x.key)).toEqual(['mina/piece/local-dsc09808#2']);
    expect(out[0].photoSource).toBe('https://catalogue.houseofmina.store/catalog-src/local/DSC09808.jpg');
    expect(out[0].added).toBe(Date.parse('2026-10-24'));
  });
  it('reads story paragraphs and tolerates fields of the wrong type', () => {
    expect(out[1].own.about).toBe('One.\n\nTwo.');
    expect(out[1].own.facts).toEqual(['Adjustable']);
    expect(out[1].photoSource).toBeNull();
    expect(out[2].facts).toEqual([]);
    expect(out[2].photos).toEqual([]);
    expect(out[2].added).toBeNull();
  });
});

describe('getSitePieces on the catalogue when its host blips', () => {
  const reply = (status: number, body?: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
  const run = async (answers: Response[]) => {
    forgetSitePieces();
    process.env.WEBSITE_ORIGIN = 'https://catalogue.houseofmina.store';
    const f = vi.fn(async (_url: string) => answers.shift() ?? reply(503));
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('reads the list', async () => {
    await run([reply(200, minaFile)]);
    expect((await getSitePieces()).pieces.length).toBe(3);
  });

  it('asks again once when the host answers 503 mid-deploy', async () => {
    const f = await run([reply(503), reply(200, minaFile)]);
    expect((await getSitePieces()).pieces.length).toBe(3);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('says what happened instead of asking taheri.shop\'s attributes file', async () => {
    const f = await run([reply(503), reply(502)]);
    await expect(getSitePieces()).rejects.toThrow(/did not give its list of pieces just now \(502\)/);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls.every(c => String(c[0]).endsWith('/catalog-pieces.json'))).toBe(true);
  });

  it('keeps the last list when a later read fails', async () => {
    await run([reply(200, minaFile)]);
    await getSitePieces();
    vi.stubGlobal('fetch', vi.fn(async () => reply(500)));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    try { expect((await getSitePieces()).pieces.length).toBe(3); } finally { vi.useRealTimers(); }
  });
});

describe('leanPiece', () => {
  it('drops the editor-only duplicates and keeps what clients read', async () => {
    const { leanPiece } = await import('./site-pieces');
    const full = parseCatalogPieces('https://catalogue.houseofmina.store', minaFile as never).map(p => ({ ...p, words: p.own, change: null, hidden: false })) as unknown as SitePiece[];
    const lean = leanPiece(full[0]) as Record<string, unknown>;
    expect(lean.own).toBeUndefined();
    expect(lean.words).toBeUndefined();
    expect('change' in lean).toBe(false);
    expect(lean.id).toBe(full[0].id);
    expect(lean.thumb).toBe(full[0].thumb);
    expect(lean.photos).toEqual(full[0].photos);
    expect(lean.hidden).toBe(false);
  });
});
