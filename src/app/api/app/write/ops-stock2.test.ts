import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handler writes through, and the Admin SDK's list of SKUs. All data made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };
/** Makes the nth transaction fail, to see a batch stop half way. */
let failOnTransaction = 0;
let transactions = 0;

const port: DbPort = {
  async runTransaction(fn) {
    transactions += 1;
    if (failOnTransaction && transactions === failOnTransaction) throw new Error('The database stopped answering.');
    const writes: (() => void)[] = [];
    const tx: TxCtx = {
      async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    return out;
  },
  async queryEquals() { return []; },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add() { return 'x'; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { writes.forEach((w) => w()); },
    };
  },
  newId() { return 'n1'; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      select: () => ({ get: async () => ({ docs: Object.keys(col(c)).map((id) => ({ id })) }) }),
    }),
  },
}));

const { STOCK2_OPS, MAX_BULK_PIECES, runStock2Op } = await import('./ops-stock2');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runStock2Op(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

/** One piece as the phone builds it for a bulk row: the shared figures with this row's weight and name. */
const piece = (weight: number, extra: Record<string, unknown> = {}) => ({
  name: '', categoryId: 'cat007', metalType: 'gold', karat: '21k', metalWeightG: weight, silverRatePerGram: 0,
  secondaryMetalType: '', secondaryMetalWeightG: 0, wastagePercentage: 8, makingCharges: 2_000,
  hasDiamonds: false, hasStones: false, stoneWeightG: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0,
  stoneDetails: '', diamondDetails: '', isCustomPrice: false, customPrice: 0, description: '', size: '',
  platingType: '', platingNote: '', nickelFree: false,
  ...extra,
});

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  failOnTransaction = 0;
  transactions = 0;
  put('products', 'BNG-000003', { sku: 'BNG-000003', name: 'Demo bangle', categoryId: 'cat007', metalType: 'gold', karat: '21k', metalWeightG: 9 });
  put('products', 'RIN-000010', { sku: 'RIN-000010', name: 'Demo ring', categoryId: 'cat001' });
});

describe('addProducts', () => {
  it('is the owners\' alone, and leaves other operations to the next group', async () => {
    expect(STOCK2_OPS).toEqual({ addProducts: ['owner'] });
    expect(await run('addProduct', { piece: piece(4) })).toBeNull();
  });

  it('adds every piece in order, numbering each after the one before it, and logs each as the store does', async () => {
    const out = await run('addProducts', { pieces: [piece(4.2), piece(5.5, { name: 'Demo set B' }), piece(6)] });
    expect(out?.status).toBe(200);
    const products = out?.body.products as { sku: string; name: string; metalWeightG: number }[];
    expect(products.map((p) => p.sku)).toEqual(['BNG-000004', 'BNG-000005', 'BNG-000006']);
    expect(products.map((p) => p.name)).toEqual(['Bangles - BNG-000004', 'Demo set B', 'Bangles - BNG-000006']);
    expect(products.map((p) => p.metalWeightG)).toEqual([4.2, 5.5, 6]);
    expect(Object.keys(data.products).sort()).toEqual(['BNG-000003', 'BNG-000004', 'BNG-000005', 'BNG-000006', 'RIN-000010']);
    expect(out?.body.partial).toBeUndefined();
    expect(out?.body.followUps).toEqual([]);
    expect(logged.map((l) => l[0])).toEqual(['product.create', 'product.create', 'product.create']);
    expect(logged[0]).toEqual(['product.create', 'Created product: Bangles - BNG-000004', 'SKU: BNG-000004', 'BNG-000004']);
  });

  it('numbers each category under its own prefix', async () => {
    const out = await run('addProducts', { pieces: [piece(3, { categoryId: 'cat001' }), piece(3.1, { categoryId: 'cat001' }), piece(2, { categoryId: 'cat008' })] });
    expect((out?.body.products as { sku: string }[]).map((p) => p.sku)).toEqual(['RIN-000011', 'RIN-000012', 'CHN-000001']);
  });

  it('applies the store\'s rules to each piece: a gold coin carries nothing but its weight', async () => {
    const out = await run('addProducts', { pieces: [piece(8, { categoryId: 'cat017', karat: '24k', wastagePercentage: 5, makingCharges: 900, miscCharges: 40 })] });
    expect(out?.status).toBe(200);
    expect(data.products['GCN-000001']).toMatchObject({ wastagePercentage: 0, makingCharges: 0, miscCharges: 0, karat: '24k', metalWeightG: 8 });
  });

  it('writes nothing when one piece is wrong, and names its row', async () => {
    const out = await run('addProducts', { pieces: [piece(4), piece(5), piece(0), piece(6)] });
    expect(out?.status).toBe(400);
    expect(out?.body.error).toBe('Piece 3: Metal weight must be a positive number');
    expect(Object.keys(data.products).sort()).toEqual(['BNG-000003', 'RIN-000010']);
    expect(logged).toEqual([]);
  });

  it('refuses a field the form does not edit, a stone heavier than the piece, and a category the shop lacks', async () => {
    expect((await run('addProducts', { pieces: [piece(4, { imageUrl: 'https://example.com/x.jpg' })] }))?.body.error).toMatch(/^Piece 1: .*imageUrl/);
    expect((await run('addProducts', { pieces: [piece(4), piece(2, { hasStones: true, stoneWeightG: 3 })] }))?.body.error)
      .toBe('Piece 2: Stone weight cannot be greater than the total metal weight.');
    expect((await run('addProducts', { pieces: [piece(4, { categoryId: 'cat999' })] }))?.body.error).toBe('Piece 1: Category is required');
    expect(Object.keys(data.products)).toHaveLength(2);
  });

  it('wants a list of one to fifty pieces', async () => {
    expect((await run('addProducts', {}))?.body.error).toBe('At least one item is required');
    expect((await run('addProducts', { pieces: [] }))?.status).toBe(400);
    expect((await run('addProducts', { pieces: 'x' }))?.status).toBe(400);
    expect((await run('addProducts', { pieces: [null] }))?.body.error).toBe('Piece 1: Nothing to save.');
    const tooMany = await run('addProducts', { pieces: Array.from({ length: MAX_BULK_PIECES + 1 }, () => piece(2)) });
    expect(tooMany?.status).toBe(400);
    expect(tooMany?.body.error).toMatch(/At most 50/);
    expect(Object.keys(data.products)).toHaveLength(2);
  });

  it('keeps the pieces already in when the database fails part way, and says how far it got', async () => {
    failOnTransaction = 3;
    const out = await run('addProducts', { pieces: [piece(4), piece(5), piece(6), piece(7)] });
    expect(out?.status).toBe(200);
    expect(out?.body).toMatchObject({ ok: true, partial: true, failedAt: 2, error: 'The database stopped answering.' });
    expect((out?.body.products as { sku: string }[]).map((p) => p.sku)).toEqual(['BNG-000004', 'BNG-000005']);
    expect(Object.keys(data.products).sort()).toEqual(['BNG-000003', 'BNG-000004', 'BNG-000005', 'RIN-000010']);
    expect(logged).toHaveLength(2);
  });

  it('lets the route answer a failure of the very first piece, when nothing went in', async () => {
    failOnTransaction = 1;
    await expect(run('addProducts', { pieces: [piece(4), piece(5)] })).rejects.toThrow('The database stopped answering.');
    expect(Object.keys(data.products).sort()).toEqual(['BNG-000003', 'RIN-000010']);
  });
});
