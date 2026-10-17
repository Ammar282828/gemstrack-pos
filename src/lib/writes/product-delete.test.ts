import { describe, expect, it } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import { deleteProduct, deleteProductWhat } from './product-delete';

// All data made up.
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  let commits = 0;
  const db: DbPort = {
    async runTransaction() { throw new Error('not used'); },
    async queryEquals() { return []; },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    async add() { return 'x'; },
    async update() { throw new Error('not used'); },
    batch() {
      const writes: (() => void)[] = [];
      return {
        set() { throw new Error('not used'); },
        update() { throw new Error('not used'); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
        async commit() { commits++; writes.forEach((w) => w()); },
      };
    },
    newId() { return 'n1'; },
    timestamp: (d: Date) => d.toISOString(),
    serverTime: () => 'server-time',
  };
  return { db, data, commits: () => commits };
}

const logger = () => {
  const lines: string[][] = [];
  return { lines, fx: { log: (a: string, t: string, d: string, r?: string) => { lines.push([a, t, d, r ?? '']); } } };
};

describe('deleteProductWhat', () => {
  it('names the piece as the store does, the SKU when it has no name', () => {
    expect(deleteProductWhat('RIN-000004', 'Demo ring')).toBe('Delete product Demo ring');
    expect(deleteProductWhat('RIN-000004', '')).toBe('Delete product RIN-000004');
    expect(deleteProductWhat('RIN-000004')).toBe('Delete product RIN-000004');
  });
});

describe('deleteProduct', () => {
  it('deletes the one piece in one commit and logs it as the store does', async () => {
    const { db, data, commits } = fakeDb({ products: { 'RIN-000004': { name: 'Demo ring' }, 'TOP-000001': { name: 'Demo tops' } } });
    const { lines, fx } = logger();
    expect(await deleteProduct(db, 'RIN-000004', fx)).toEqual({ sku: 'RIN-000004', name: 'Demo ring' });
    expect(Object.keys(data.products)).toEqual(['TOP-000001']);
    expect(commits()).toBe(1);
    await Promise.resolve();
    expect(lines).toEqual([['product.delete', 'Deleted product: Demo ring', 'SKU: RIN-000004', 'RIN-000004']]);
  });

  it('names a piece without a name by its SKU', async () => {
    const { db } = fakeDb({ products: { 'XXX-000002': { name: '' } } });
    expect((await deleteProduct(db, 'XXX-000002')).name).toBe('XXX-000002');
  });

  it('refuses a piece that is not in stock, touching nothing', async () => {
    const { db, commits } = fakeDb({ products: {}, sold_products: { 'RIN-000001': { name: 'Demo sold ring' } } });
    await expect(deleteProduct(db, 'RIN-000001')).rejects.toThrow(/^No such piece/);
    expect(commits()).toBe(0);
  });
});
