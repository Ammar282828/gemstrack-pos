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

vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/firebase', () => ({ db: {} }));

const { SETTLE_OPS, runSettleOp } = await import('./ops-settle');

let logged: string[][] = [];
const alerts: Record<string, unknown>[] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: (b) => { alerts.push(b); },
  followUps: [],
});
const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runSettleOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

const invoice = () => ({
  subtotal: 100_000, discountAmount: 0, grandTotal: 100_000, amountPaid: 60_000, balanceDue: 40_000,
  customerId: 'c1', customerName: 'Sakina Demo', createdAt: '2026-10-01T10:00:00.000Z', sourceOrderId: 'ORD-1',
  paymentHistory: [{ amount: 60_000, date: '2026-10-01', method: 'Cash' }],
});
const order = (more: Record<string, unknown> = {}) => ({
  status: 'In Progress', subtotal: 100_000, discountAmount: 0, advancePayment: 50_000, grandTotal: 50_000,
  advances: [{ amount: 50_000, date: '2026-10-01' }],
  items: [{ description: 'Ring', isCompleted: false }, { description: 'Bangle', isCompleted: false }], ...more,
});

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0; logged = []; alerts.length = 0;
});

describe('who may settle', () => {
  it('owners only: staff are refused by the route, so no payment is taken without its discount', () => {
    expect(SETTLE_OPS).toEqual({ settleInvoicePayment: ['owner'], settleOrderAdvance: ['owner'], raiseOrderDiscount: ['owner'] });
  });
  it('leaves other operations to the next group', async () => {
    expect(await runSettleOp('updateOrder', {}, ctx())).toBeNull();
  });
});

describe('settleInvoicePayment', () => {
  it('records the payment and raises the discount in one write: balance 0, ledger row gone, order balance 0', async () => {
    put('invoices', 'INV-1', invoice());
    put('hisaab', 'h1', { linkedInvoiceId: 'INV-1', cashDebit: 40_000 });
    put('orders', 'ORD-1', { grandTotal: 40_000 });
    const r = await run('settleInvoicePayment', { invoiceId: 'INV-1', amount: 37_660, extra: 2_340, method: 'Cash' });
    expect(r?.status).toBe(200);
    expect(col('invoices')['INV-1']).toMatchObject({ discountAmount: 2_340, grandTotal: 97_660, amountPaid: 97_660, balanceDue: 0 });
    expect((col('invoices')['INV-1'].paymentHistory as unknown[]).length).toBe(2);
    expect(col('hisaab').h1).toBeUndefined();
    expect(col('orders')['ORD-1']).toEqual({ grandTotal: 0 });
    expect(alerts).toHaveLength(1);
  });

  it('rounds a fraction to whole rupees', async () => {
    put('invoices', 'INV-1', invoice());
    await run('settleInvoicePayment', { invoiceId: 'INV-1', amount: 37_659.6, extra: 2_340.4, method: 'Cash' });
    expect(col('invoices')['INV-1']).toMatchObject({ discountAmount: 2_340, amountPaid: 97_660, balanceDue: 0 });
  });

  it('a refused discount takes no payment either (atomic)', async () => {
    put('invoices', 'INV-1', invoice());
    const r = await run('settleInvoicePayment', { invoiceId: 'INV-1', amount: 1_000, extra: 200_000, method: 'Cash' });
    expect(r?.status).toBe(400);
    expect(col('invoices')['INV-1']).toEqual(invoice());
  });

  it('refuses a missing invoice, a missing amount or extra', async () => {
    expect((await run('settleInvoicePayment', { invoiceId: 'INV-404', amount: 1, extra: 1 }))?.status).toBe(409);
    expect((await run('settleInvoicePayment', { invoiceId: 'INV-1', amount: 0, extra: 1 }))?.status).toBe(400);
    expect((await run('settleInvoicePayment', { invoiceId: 'INV-1', amount: 5, extra: 0 }))?.status).toBe(400);
  });
});

describe('raiseOrderDiscount', () => {
  it('touches only the discount, the balance and updatedAt: the stage and pieces stay', async () => {
    put('orders', 'ORD-1', order({ items: [{ description: 'Ring', isCompleted: true, karigarId: 'k1' }], status: 'Pending' }));
    const r = await run('raiseOrderDiscount', { orderId: 'ORD-1', extra: 2_340.4 });
    expect(r?.status).toBe(200);
    const after = col('orders')['ORD-1'];
    expect(after).toMatchObject({ discountAmount: 2_340, grandTotal: 47_660, advancePayment: 50_000, status: 'Pending' });
    expect(typeof after.updatedAt).toBe('string');
    expect(after.items).toEqual([{ description: 'Ring', isCompleted: true, karigarId: 'k1' }]);
    expect(Object.keys(after).sort()).toEqual([...Object.keys(order()), 'updatedAt'].sort());
  });

  it('adds to the discount already given, and refuses past the subtotal or on an invoiced order', async () => {
    put('orders', 'ORD-1', order({ discountAmount: 1_000, grandTotal: 49_000 }));
    await run('raiseOrderDiscount', { orderId: 'ORD-1', extra: 500 });
    expect(col('orders')['ORD-1']).toMatchObject({ discountAmount: 1_500, grandTotal: 48_500 });
    expect((await run('raiseOrderDiscount', { orderId: 'ORD-1', extra: 200_000 }))?.status).toBe(400);
    put('orders', 'ORD-2', order({ invoiceId: 'INV-9' }));
    expect((await run('raiseOrderDiscount', { orderId: 'ORD-2', extra: 100 }))?.status).toBe(409);
    expect((await run('raiseOrderDiscount', { orderId: 'ORD-404', extra: 100 }))?.status).toBe(409);
  });
});

describe('settleOrderAdvance', () => {
  it('adds the advance and the discount together, the stage untouched', async () => {
    put('orders', 'ORD-1', order());
    const r = await run('settleOrderAdvance', { orderId: 'ORD-1', amount: 47_660, extra: 2_340, method: 'Cash', notes: 'Last advance' });
    expect(r?.status).toBe(200);
    const after = col('orders')['ORD-1'];
    expect(after).toMatchObject({ advancePayment: 97_660, discountAmount: 2_340, grandTotal: 0, status: 'In Progress' });
    expect((after.advances as { amount: number }[]).map((a) => a.amount)).toEqual([50_000, 47_660]);
  });

  it('a refused discount leaves the advance unrecorded', async () => {
    put('orders', 'ORD-1', order());
    expect((await run('settleOrderAdvance', { orderId: 'ORD-1', amount: 1_000, extra: 999_999 }))?.status).toBe(400);
    expect(col('orders')['ORD-1']).toEqual(order());
  });
});
