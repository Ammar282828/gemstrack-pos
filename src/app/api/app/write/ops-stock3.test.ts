import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port. All names and SKUs made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});

const port: DbPort = {
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
      async commit() { writes.forEach((w) => w()); },
    };
  },
  newId: () => 'n1',
  timestamp: (d) => d.toISOString(),
  serverTime: () => 'now',
};

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { STOCK3_OPS, runStock3Op } = await import('./ops-stock3');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runStock3Op(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  codeChecks.length = 0;
  logged = [];
  data.products = { 'RIN-000004': { name: 'Demo ring' }, 'TOP-000001': { name: '' } };
});

describe('the group', () => {
  it('is the owners\'', () => {
    expect(STOCK3_OPS).toEqual({ deleteProduct: ['owner'] });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runStock3Op('addProduct', {}, ctx())).toBeNull();
  });
});

describe('deleteProduct', () => {
  it('deletes the piece behind the delete code, in the store\'s words, and logs it', async () => {
    const r = await run('deleteProduct', { sku: 'RIN-000004', deleteCode: '4321' });
    expect(r).toEqual({ status: 200, body: { ok: true, sku: 'RIN-000004', name: 'Demo ring', followUps: [] } });
    expect(Object.keys(col('products'))).toEqual(['TOP-000001']);
    expect(codeChecks).toEqual(['Delete product Demo ring']);
    await Promise.resolve();
    expect(logged).toEqual([['product.delete', 'Deleted product: Demo ring', 'SKU: RIN-000004', 'RIN-000004']]);
  });

  it('names a piece without a name by its SKU', async () => {
    await run('deleteProduct', { sku: 'TOP-000001', deleteCode: '4321' });
    expect(codeChecks).toEqual(['Delete product TOP-000001']);
  });

  it('deletes nothing on a wrong code', async () => {
    expect((await run('deleteProduct', { sku: 'RIN-000004', deleteCode: '1111' }))?.status).toBe(403);
    expect(Object.keys(col('products'))).toHaveLength(2);
    expect(logged).toEqual([]);
  });

  it('says a piece is not in stock before the code is asked, and asks which piece for none', async () => {
    expect((await run('deleteProduct', { sku: 'RIN-999999', deleteCode: '4321' }))?.status).toBe(409);
    expect(codeChecks).toEqual([]);
    for (const sku of ['', 'a/b', 7, undefined]) expect((await run('deleteProduct', { sku, deleteCode: '4321' }))?.status).toBe(400);
  });
});
