import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port. All names, ids and amounts made up.
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
  newId: () => 'n1',
  timestamp: (d) => d.toISOString(),
  serverTime: () => 'now',
};

vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/people', () => ({ personFor: () => 'Demo Owner' }));

const { WORK2_OPS, runWork2Op } = await import('./ops-work2');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});
const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runWork2Op(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  put('orders', 'ORD-1', { items: [{ description: 'Demo ring', stoneDetails: 'Old line', estimatedWeightG: 4 }] });
  put('invoices', 'INV-1', { items: [{ name: 'Demo bangle', metalWeightG: 8 }] });
});

describe('who may', () => {
  it('owners only', () => {
    for (const roles of Object.values(WORK2_OPS)) expect(roles).toEqual(['owner']);
  });
  it('leaves other operations to the next group', async () => {
    expect(await run('deleteInvoice', {})).toBeNull();
  });
});

describe('updateOrderPieceDetails', () => {
  it('writes the dialog\'s fields: the instructions as the note, the old stone line cleared', async () => {
    const out = await run('updateOrderPieceDetails', {
      orderId: 'ORD-1', itemIndex: 0,
      patch: { name: 'Demo ring', size: '12', instructions: 'Plate it', referenceSku: 'RIN-9', estimatedWeightG: 4.5 },
    });
    expect(out?.status).toBe(200);
    expect(col('orders')['ORD-1'].items).toEqual([{ description: 'Demo ring', size: '12', adminNote: 'Plate it', referenceSku: 'RIN-9', estimatedWeightG: 4.5 }]);
  });

  it('refuses a cleared name, a bad picture, a bad weight and a piece that is gone', async () => {
    expect((await run('updateOrderPieceDetails', { orderId: 'ORD-1', itemIndex: 0, patch: { name: ' ' } }))?.body.error).toBe('An item needs a name.');
    expect((await run('updateOrderPieceDetails', { orderId: 'ORD-1', itemIndex: 0, patch: { sampleImageDataUri: 'javascript:1' } }))?.status).toBe(400);
    expect((await run('updateOrderPieceDetails', { orderId: 'ORD-1', itemIndex: 0, patch: { estimatedWeightG: '4' } }))?.status).toBe(400);
    expect((await run('updateOrderPieceDetails', { orderId: 'ORD-1', itemIndex: 1.5, patch: { size: '1' } }))?.status).toBe(400);
    expect((await run('updateOrderPieceDetails', { orderId: 'ORD-1', itemIndex: 4, patch: { size: '1' } }))?.status).toBe(409);
    expect((await run('updateOrderPieceDetails', { orderId: 'ORD-1', itemIndex: 0, patch: {} }))?.body.error).toBe('Nothing to change.');
    expect(col('orders')['ORD-1'].items).toEqual([{ description: 'Demo ring', stoneDetails: 'Old line', estimatedWeightG: 4 }]);
  });
});

describe('updateInvoicePieceDetails', () => {
  it('takes the name, size and instructions only', async () => {
    const out = await run('updateInvoicePieceDetails', { invoiceId: 'INV-1', itemIndex: 0, patch: { name: 'Demo kara', instructions: 'Polish', metalWeightG: 1 } });
    expect(out?.status).toBe(200);
    expect(col('invoices')['INV-1'].items).toEqual([{ name: 'Demo kara', adminNote: 'Polish', metalWeightG: 8 }]);
  });
});

describe('lockDatabase', () => {
  it('needs the confirmation, then locks', async () => {
    expect((await run('lockDatabase', {}))?.status).toBe(400);
    expect(col('app_settings')['global']).toBeUndefined();
    expect((await run('lockDatabase', { confirm: true }))?.status).toBe(200);
    expect(col('app_settings')['global']).toEqual({ databaseLocked: true });
    expect(logged).toEqual([['settings.lock', 'Database locked', 'Emergency lock by Demo Owner', 'global']]);
  });
});
