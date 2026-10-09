import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handler writes through. All names, skus and amounts made up.
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
  async queryEquals(c, field, value) {
    return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...structuredClone(d), id }) as never);
  },
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
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => REMOVE } }));
// Every invoice's pieces, as the server reads them for "sold elsewhere".
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      select: () => ({
        get: async () => ({ docs: Object.entries(col(c)).map(([id, d]) => ({ id, data: () => ({ items: d.items }) })) }),
      }),
    }),
  },
}));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { ORDER_OPS, runOrderOp } = await import('./ops-orders');

let logged: string[][] = [];
let lastCtx: OpContext;
const ctx = (): OpContext => (lastCtx = {
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runOrderOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

const ring = { sku: 'RNG-301', name: 'Test ring', metalType: 'gold', karat: '21k', metalWeightG: 3.5, stoneChargesIfAny: 0, diamondChargesIfAny: 0, unitPrice: 60_000 };

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  codeChecks.length = 0;
  Object.assign(data, {
    orders: {
      'ORD-000031': { status: 'Completed', invoiceId: 'INV-000090', customerName: 'Test Customer' },
      'ORD-000032': { status: 'Pending', customerName: 'Test Customer', shopifyDraftOrderId: 'D-12' },
      'ORD-000033': { status: 'Refunded', customerName: 'Test Customer' },
    },
    invoices: { 'INV-000090': { items: [ring], customerName: 'Test Customer', sourceOrderId: 'ORD-000031' } },
    sold_products: { 'RNG-301': { sku: 'RNG-301' } },
    hisaab: { h1: { linkedInvoiceId: 'INV-000090', cashDebit: 20_000 } },
    order_photos: { p1: { orderId: 'ORD-000032', dataUri: 'data:x' } },
  });
});

describe('who may', () => {
  it('owners only: each moves money or takes a sale off the books', () => {
    expect(ORDER_OPS).toEqual({ undoOrderInvoice: ['owner'], refundOrder: ['owner'], deleteOrder: ['owner'] });
  });

  it('leaves any other operation to the next group', async () => {
    expect(await run('recordPayment', { orderId: 'ORD-000031' })).toBeNull();
  });
});

describe('undoOrderInvoice', () => {
  it('asks the code in the store\'s words, then opens the order again', async () => {
    const out = await run('undoOrderInvoice', { orderId: 'ORD-000031', invoiceId: 'INV-000090', deleteCode: '4321' });
    expect(out).toEqual({ status: 200, body: { ok: true, orderId: 'ORD-000031', invoiceId: 'INV-000090', status: 'In Progress', removed: true, followUps: [] } });
    expect(codeChecks).toEqual(['Undo invoice INV-000090 back to order ORD-000031']);
    expect(data.invoices['INV-000090']).toBeUndefined();
    expect(data.hisaab.h1).toBeUndefined();
    expect(data.sold_products['RNG-301']).toBeDefined(); // an undo leaves the pieces sold
    expect(data.orders['ORD-000031']).toEqual({ status: 'In Progress', customerName: 'Test Customer' });
    expect(logged.map(l => l[0])).toEqual(['invoice.delete', 'order.revert']);
  });

  it('a wrong code touches nothing', async () => {
    const out = await run('undoOrderInvoice', { orderId: 'ORD-000031', deleteCode: '1111' });
    expect(out).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect(data.invoices['INV-000090']).toBeDefined();
    expect(data.orders['ORD-000031'].invoiceId).toBe('INV-000090');
  });

  it('says what is wrong before a try is spent: no order, no invoice, a different invoice', async () => {
    expect(await run('undoOrderInvoice', { orderId: 'ORD-404', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'No such order.' } });
    expect(await run('undoOrderInvoice', { orderId: 'ORD-000032', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'ORD-000032 has no invoice to undo.' } });
    expect((await run('undoOrderInvoice', { orderId: 'ORD-000031', invoiceId: 'INV-000001', deleteCode: '4321' }))?.status).toBe(409);
    expect(await run('undoOrderInvoice', { orderId: '../x', deleteCode: '4321' })).toEqual({ status: 400, body: { error: 'Which order?' } });
    expect(codeChecks).toEqual([]);
  });
});

describe('refundOrder', () => {
  it('deletes the invoice, puts the piece back in stock, marks the order Refunded', async () => {
    const out = await run('refundOrder', { orderId: 'ORD-000031', invoiceId: 'INV-000090', deleteCode: '4321' });
    expect(out?.status).toBe(200);
    expect(out?.body).toMatchObject({ ok: true, orderId: 'ORD-000031', invoiceId: 'INV-000090', restocked: ['RNG-301'] });
    expect(codeChecks).toEqual(['Refund order ORD-000031']);
    expect(data.products['RNG-301']).toMatchObject({ sku: 'RNG-301', name: 'Test ring', metalWeightG: 3.5 });
    expect(data.sold_products['RNG-301']).toBeUndefined();
    expect(data.orders['ORD-000031']).toEqual({ status: 'Refunded', customerName: 'Test Customer' });
    // No Shopify order behind it: still asked by its tag, as the store asks.
    expect(out?.body.followUps).toEqual([{ path: '/api/shopify/sync/invoice', body: { invoiceId: 'INV-000090', action: 'refund' } }]);
  });

  it('refuses an order already refunded, and one whose invoice changed since the screen showed it', async () => {
    expect(await run('refundOrder', { orderId: 'ORD-000033', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'ORD-000033 is already refunded.' } });
    expect((await run('refundOrder', { orderId: 'ORD-000031', invoiceId: '', deleteCode: '4321' }))?.status).toBe(409);
    expect(codeChecks).toEqual([]);
    expect(data.invoices['INV-000090']).toBeDefined();
  });

  it('an order with no invoice: Refunded, its draft dropped after', async () => {
    const out = await run('refundOrder', { orderId: 'ORD-000032', invoiceId: '', deleteCode: '4321' });
    expect(out?.status).toBe(200);
    expect(data.orders['ORD-000032'].status).toBe('Refunded');
    expect(lastCtx.followUps).toEqual([{ path: '/api/shopify/sync/order', body: { orderId: 'ORD-000032', shopifyDraftOrderId: 'D-12', action: 'cancel' } }]);
  });
});

describe('deleteOrder', () => {
  it('refuses an invoiced order in the page\'s words, before the code', async () => {
    expect(await run('deleteOrder', { orderId: 'ORD-000031', deleteCode: '4321' })).toEqual({
      status: 409, body: { error: 'ORD-000031 has invoice INV-000090. Delete or undo the invoice first.' },
    });
    expect(codeChecks).toEqual([]);
  });

  it('deletes the order and its photos with the code, and drops its Shopify draft after', async () => {
    const out = await run('deleteOrder', { orderId: 'ORD-000032', deleteCode: '4321' });
    expect(out).toEqual({
      status: 200,
      body: { ok: true, orderId: 'ORD-000032', photos: 1, followUps: [{ path: '/api/shopify/sync/order', body: { orderId: 'ORD-000032', shopifyDraftOrderId: 'D-12', action: 'cancel' } }] },
    });
    expect(codeChecks).toEqual(['Delete order ORD-000032']);
    expect(data.orders['ORD-000032']).toBeUndefined();
    expect(data.order_photos).toEqual({});
    expect(logged).toEqual([['order.delete', 'Deleted order: ORD-000032', 'Customer: Test Customer', 'ORD-000032']]);
  });

  it('a missing code is refused by the gate, and nothing goes', async () => {
    const out = await run('deleteOrder', { orderId: 'ORD-000032' });
    expect(out?.status).toBe(403);
    expect(data.orders['ORD-000032']).toBeDefined();
  });
});
