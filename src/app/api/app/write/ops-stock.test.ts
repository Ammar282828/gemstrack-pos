import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handler writes through, and the Admin SDK's list of SKUs. All data made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };

const port: DbPort = {
  async runTransaction(fn) {
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

const { STOCK_OPS, runStockOp } = await import('./ops-stock');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runStockOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

/** The phone's body for a new ring: every field the form edits. */
const piece = {
  name: '', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 4.2, silverRatePerGram: 0,
  secondaryMetalType: '', secondaryMetalWeightG: 0, wastagePercentage: 10, makingCharges: 3_000,
  hasDiamonds: false, hasStones: true, stoneWeightG: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0,
  stoneDetails: '', diamondDetails: '', isCustomPrice: false, customPrice: 0, description: '', size: '12',
  platingType: '', platingNote: '', nickelFree: false,
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  put('products', 'RIN-000003', { sku: 'RIN-000003', name: 'Demo ring', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 3, imageUrl: 'https://example.com/demo.jpg' });
  put('sold_products', 'RIN-000002', { sku: 'RIN-000002', name: 'Demo sold ring' });
});

describe('stock operations', () => {
  it('are the owners\' alone, and leave other operations to the next group', async () => {
    expect(STOCK_OPS).toEqual({ addProduct: ['owner'], updateProduct: ['owner'] });
    expect(await run('addCustomer', { name: 'x' })).toBeNull();
  });

  it('adds a piece under the next SKU in stock, with the store\'s log line', async () => {
    const out = await run('addProduct', { piece });
    expect(out?.status).toBe(200);
    expect(out?.body.product).toMatchObject({ sku: 'RIN-000004', name: 'Rings - RIN-000004', metalWeightG: 4.2 });
    expect(data.products['RIN-000004']).toBeTruthy();
    expect(out?.body.followUps).toEqual([]);
    expect(logged).toEqual([['product.create', 'Created product: Rings - RIN-000004', 'SKU: RIN-000004', 'RIN-000004']]);
  });

  it('refuses a piece the form would refuse, and a field it does not edit', async () => {
    expect((await run('addProduct', { piece: { ...piece, metalWeightG: 0 } }))?.status).toBe(400);
    expect((await run('addProduct', { piece: { ...piece, imageUrl: 'https://example.com/x.jpg' } }))?.body.error).toMatch(/imageUrl/);
    expect((await run('addProduct', {}))?.status).toBe(400);
    expect(Object.keys(data.products)).toEqual(['RIN-000003']);
  });

  it('edits a piece in stock and keeps its photo', async () => {
    const out = await run('updateProduct', { sku: 'RIN-000003', piece: { ...piece, name: 'Demo ring, resized', metalWeightG: 3.4 } });
    expect(out?.status).toBe(200);
    expect(data.products['RIN-000003']).toMatchObject({ name: 'Demo ring, resized', metalWeightG: 3.4, imageUrl: 'https://example.com/demo.jpg', size: '12' });
    expect(out?.body.product).toMatchObject({ name: 'Demo ring, resized' });
    expect(logged).toEqual([['product.update', 'Updated product: Demo ring, resized', 'SKU: RIN-000003', 'RIN-000003']]);
  });

  it('refuses an edit to a sold piece, or to one that is not there', async () => {
    const sold = await run('updateProduct', { sku: 'RIN-000002', piece });
    expect(sold?.status).toBe(409);
    expect(sold?.body.error).toMatch(/sold/);
    expect(data.products['RIN-000002']).toBeUndefined();
    expect((await run('updateProduct', { sku: 'RIN-999999', piece }))?.status).toBe(409);
    expect((await run('updateProduct', { sku: 'a/b', piece }))?.status).toBe(400);
  });
});
