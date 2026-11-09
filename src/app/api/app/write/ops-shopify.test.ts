import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind both the port the handler writes through and the Admin SDK it reads other
// invoices from. All names and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
const REMOVE = '<field removed>';
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
  const next: Record<string, unknown> = merge ? { ...col(c)[id], ...d } : { ...d };
  for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
  col(c)[id] = next;
};

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
  async queryEquals(c, field, value) { return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...structuredClone(d), id }) as never); },
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
  newId(c) { ids += 1; return `${c}-${ids}`; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: () => ({ doc: () => ({ set: async () => undefined }) }) },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => REMOVE } }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { SHOPIFY_OPS, runShopifyOp } = await import('./ops-shopify');
const { MONEY_OP_NAMES } = await import('./idempotency');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});
const run = async (body: Record<string, unknown>) => {
  const res = await runShopifyOp('shopifyInvoicesToOrders', { op: 'shopifyInvoicesToOrders', ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

const invoice = (more: Record<string, unknown> = {}) => ({
  source: 'shopify', customerId: 'shopify-9', customerName: 'Sara Ali', createdAt: '2026-10-20T10:00:00.000Z',
  subtotal: 5000, discountAmount: 0, grandTotal: 5000, amountPaid: 1000, balanceDue: 4000,
  items: [{ sku: 'SHOPIFY-1', name: 'Ring', quantity: 1, unitPrice: 5000, itemTotal: 5000, metalType: 'silver' }],
  paymentHistory: [{ id: 'p1', amount: 1000, date: '2026-10-20T11:00:00.000Z' }],
  shopifyOrderId: '7445', shopifyOrderNumber: 1440, shopifyFulfillment: 'unfulfilled',
  ...more,
});

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0; logged = []; codeChecks.length = 0;
  put('app_settings', 'global', { lastOrderNumber: 5, goldRatePerGram24k: 1, goldRatePerGram22k: 1, goldRatePerGram21k: 1, goldRatePerGram18k: 1, silverRatePerGram: 1 });
});

describe('shopifyInvoicesToOrders', () => {
  it('is the owner\'s, and a money op: it needs a request id', () => {
    expect(SHOPIFY_OPS).toEqual({ shopifyInvoicesToOrders: ['owner'] });
    expect(MONEY_OP_NAMES.has('shopifyInvoicesToOrders')).toBe(true);
  });

  it('leaves another operation to the next group', async () => {
    expect(await runShopifyOp('deleteInvoice', {}, ctx())).toBeNull();
  });

  it('refuses bad ids before any code is asked', async () => {
    for (const invoiceIds of [undefined, [], [''], ['a/b'], [5], Array.from({ length: 101 }, (_, i) => `I${i}`)]) {
      expect((await run({ invoiceIds, deleteCode: '4321' }))?.status).toBe(400);
    }
    expect(codeChecks).toEqual([]);
  });

  it('refuses a wrong or missing delete code and changes nothing', async () => {
    put('invoices', 'INV-1', invoice());
    expect(await run({ invoiceIds: ['INV-1'], deleteCode: '0000' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect((await run({ invoiceIds: ['INV-1'] }))?.status).toBe(403);
    expect(codeChecks).toEqual(['Make invoice INV-1 an order', 'Make invoice INV-1 an order']);
    expect(col('invoices')['INV-1']).toBeDefined();
    expect(col('orders')).toEqual({});
  });

  it('converts the eligible, reports the rest, and the order carries the payment as an advance', async () => {
    put('invoices', 'INV-1', invoice());
    put('invoices', 'INV-2', invoice({ shopifyOrderNumber: 1441, shopifyFulfillment: 'fulfilled' }));
    put('hisaab', 'h1', { linkedInvoiceId: 'INV-1', amount: 4000 });
    const res = await run({ invoiceIds: ['INV-1', 'INV-2', 'INV-1'], deleteCode: '4321' });
    expect(res).toEqual({ status: 200, body: {
      ok: true, converted: [{ invoiceId: 'INV-1', orderId: 'SHOPIFY-1440' }], skipped: [{ invoiceId: 'INV-2', reason: 'already fulfilled' }], followUps: [],
    } });
    expect(codeChecks).toEqual(['Make 2 Shopify invoices orders']);
    expect(col('orders')['SHOPIFY-1440']).toMatchObject({ status: 'Pending', advancePayment: 1000, grandTotal: 4000, advances: [{ id: 'adv-from-INV-1-p1', amount: 1000 }] });
    expect(Object.keys(col('invoices'))).toEqual(['INV-2']);
    expect(col('hisaab')).toEqual({});
    expect(logged.map(l => l[0])).toEqual(['order.create']);
  });
});
