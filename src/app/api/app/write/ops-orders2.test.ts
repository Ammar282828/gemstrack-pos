import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handlers write through. All names and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const REMOVE = '<field removed>';
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
  const next: Record<string, unknown> = merge ? { ...col(c)[id], ...d } : { ...d };
  for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
  col(c)[id] = next;
};

const port: DbPort = {
  async runTransaction(fn) {
    const tx: TxCtx = {
      async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set: (c, id, d, m) => put(c, id, d, m),
      update: (c, id, d) => put(c, id, d, true),
      delete: (c, id) => { delete col(c)[id]; },
    };
    return fn(tx);
  },
  async queryEquals() { return []; },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
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
  newId: (c) => `${c}-new`,
  timestamp: (d) => d.toISOString(),
  serverTime: () => 'server-time',
};

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => REMOVE } }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { ORDERS2_OPS, runOrders2Op } = await import('./ops-orders2');
const { INVOICES2_OPS, runInvoices2Op } = await import('./ops-invoices2');

let logged: string[] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (_a, t) => { logged.push(t); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = (await runOrders2Op(op, { op, ...body }, ctx())) ?? (await runInvoices2Op(op, { op, ...body }, ctx()));
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

const piece = (description: string, totalEstimate: number) => ({ description, totalEstimate });

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  codeChecks.length = 0;
  Object.assign(data, {
    orders: {
      'ORD-000041': {
        createdAt: '2026-10-01T10:00:00.000Z', items: [piece('Test ring', 40000), piece('Test chain', 20000)],
        subtotal: 60000, advancePayment: 10000, advanceMethod: 'Cash', grandTotal: 50000,
      },
      'ORD-000042': { createdAt: '2026-10-01T10:00:00.000Z', items: [piece('A', 1), piece('B', 1)], invoiceId: 'INV-000090', advancePayment: 5 },
    },
    invoices: { 'INV-000090': { grandTotal: 2 } },
  });
});

describe('who may', () => {
  it('owners only: in the browser each is the store\'s own Firestore write', () => {
    expect(ORDERS2_OPS).toEqual({ removeOrderPiece: ['owner'], deleteOrderAdvance: ['owner'] });
    expect(INVOICES2_OPS).toEqual({ giveInvoiceShareKey: ['owner'], importShopifyCsv: ['owner'] });
  });

  it('leaves any other operation to the next group', async () => {
    expect(await runOrders2Op('deleteOrder', { orderId: 'ORD-000041' }, ctx())).toBeNull();
    expect(await runInvoices2Op('deleteInvoice', { invoiceId: 'INV-000090' }, ctx())).toBeNull();
  });
});

describe('removeOrderPiece', () => {
  it('asks the code in the store\'s words, then takes the piece shown off', async () => {
    const out = await run('removeOrderPiece', { orderId: 'ORD-000041', index: 1, description: 'Test chain', deleteCode: '4321' });
    expect(out?.status).toBe(200);
    expect(codeChecks).toEqual(['Remove item 2 from ORD-000041']);
    expect(data.orders['ORD-000041']).toMatchObject({ subtotal: 40000, grandTotal: 30000, summary: 'Test ring' });
    expect(logged).toEqual(['Removed item from order: ORD-000041']);
  });

  it('says what is wrong before a try is spent', async () => {
    expect((await run('removeOrderPiece', { orderId: 'ORD-000041', index: 1, description: 'Test ring', deleteCode: '4321' }))?.status).toBe(409);
    expect((await run('removeOrderPiece', { orderId: 'ORD-000042', index: 0, deleteCode: '4321' }))?.status).toBe(409);
    expect(await run('removeOrderPiece', { orderId: 'ORD-000041', index: -1 })).toEqual({ status: 400, body: { error: 'Which piece?' } });
    expect(await run('removeOrderPiece', { orderId: 'ORD-404', index: 0 })).toEqual({ status: 409, body: { error: 'No such order.' } });
    expect(codeChecks).toEqual([]);
  });

  it('a wrong code touches nothing', async () => {
    expect(await run('removeOrderPiece', { orderId: 'ORD-000041', index: 0, deleteCode: '1111' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect((data.orders['ORD-000041'].items as unknown[]).length).toBe(2);
  });
});

describe('deleteOrderAdvance', () => {
  it('asks the code, then takes the line shown off, its method with it', async () => {
    const out = await run('deleteOrderAdvance', { orderId: 'ORD-000041', lineIndex: 0, amount: 10000, deleteCode: '4321' });
    expect(out?.status).toBe(200);
    expect(codeChecks).toEqual([`Delete the advance of PKR ${(10000).toLocaleString()} on ORD-000041`]);
    expect(data.orders['ORD-000041']).toMatchObject({ advancePayment: 0, grandTotal: 60000 });
    expect(data.orders['ORD-000041'].advanceMethod).toBeUndefined();
  });

  it('refuses an invoiced order and a line that moved, without a try', async () => {
    expect((await run('deleteOrderAdvance', { orderId: 'ORD-000042', lineIndex: 0, amount: 5, deleteCode: '4321' }))?.status).toBe(409);
    expect((await run('deleteOrderAdvance', { orderId: 'ORD-000041', lineIndex: 0, amount: 9000, deleteCode: '4321' }))?.status).toBe(409);
    expect(codeChecks).toEqual([]);
  });
});

describe('giveInvoiceShareKey', () => {
  it('gives the key once and answers the same one after', async () => {
    const first = await run('giveInvoiceShareKey', { invoiceId: 'INV-000090' });
    expect(first?.status).toBe(200);
    const key = first?.body.shareToken as string;
    expect(key).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect((await run('giveInvoiceShareKey', { invoiceId: 'INV-000090' }))?.body.shareToken).toBe(key);
    expect(logged).toEqual(['Link key given to INV-000090']);
    expect((await run('giveInvoiceShareKey', { invoiceId: 'INV-404' }))?.status).toBe(409);
  });
});

describe('importShopifyCsv', () => {
  const csv = 'Name,Created at,Billing Name,Financial Status,Total,Lineitem name,Lineitem price,Lineitem quantity\n#1001,2026-09-01 10:00:00 +0500,Test Buyer,paid,3000,Studs,3000,1';

  it('previews without writing, then imports on from the counter', async () => {
    data.app_settings = { global: { lastInvoiceNumber: 90 } };
    expect(await run('importShopifyCsv', { csv, preview: true })).toEqual({ status: 200, body: { ok: true, rows: 1, firstNames: ['Test Buyer'], orders: 1 } });
    expect(data.invoices['INV-000091']).toBeUndefined();
    const out = await run('importShopifyCsv', { csv });
    expect(out?.body).toMatchObject({ ok: true, imported: 1, first: 'INV-000091', last: 'INV-000091' });
    expect(data.invoices['INV-000091']).toMatchObject({ customerName: 'Test Buyer', grandTotal: 3000 });
  });

  it('refuses an empty file and a stale counter', async () => {
    expect((await run('importShopifyCsv', { csv: ' ' }))?.status).toBe(400);
    data.app_settings = { global: { lastInvoiceNumber: 89 } };
    expect((await run('importShopifyCsv', { csv }))?.status).toBe(409);
  });
});
