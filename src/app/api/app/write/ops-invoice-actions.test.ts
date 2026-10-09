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
let invoiceReads = 0;
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      select: () => ({
        get: async () => {
          if (c === 'invoices') invoiceReads += 1;
          return { docs: Object.entries(col(c)).map(([id, d]) => ({ id, data: () => ({ items: d.items }) })) };
        },
      }),
    }),
  },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => REMOVE } }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { INVOICE_ACTION_OPS, runInvoiceActionOp } = await import('./ops-invoice-actions');

let logged: string[][] = [];
let followUps: { path: string; body: Record<string, unknown> }[] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps,
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runInvoiceActionOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

const invoice = (more: Record<string, unknown> = {}) => ({
  subtotal: 100_000, discountAmount: 0, grandTotal: 100_000, amountPaid: 60_000, balanceDue: 40_000,
  customerId: 'c1', customerName: 'Sakina Demo', createdAt: '2026-10-01T10:00:00.000Z',
  paymentHistory: [{ amount: 30_000, date: '2026-09-25', notes: 'Advance on order ORD-1' }, { amount: 30_000, date: '2026-10-01', method: 'Cash' }],
  items: [{ sku: 'RNG-001', name: 'Ruby ring', metalType: 'gold', karat: '21k', unitPrice: 100_000, stoneChargesIfAny: 0, diamondChargesIfAny: 0 }],
  ...more,
});

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  logged = [];
  followUps = [];
  codeChecks.length = 0;
  invoiceReads = 0;
});

describe('who may run the invoice actions', () => {
  it('owners only: each is the store\'s own Firestore write on the web', () => {
    expect(INVOICE_ACTION_OPS).toEqual({
      updateInvoiceDiscount: ['owner'], deleteInvoicePayment: ['owner'], refundInvoicePartial: ['owner'], deleteInvoice: ['owner'],
    });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runInvoiceActionOp('recordPayment', {}, ctx())).toBeNull();
  });

  it('names the invoice, and says one not on file before any code is asked', async () => {
    for (const op of Object.keys(INVOICE_ACTION_OPS)) {
      expect((await run(op, { invoiceId: '' }))?.status).toBe(400);
      expect((await run(op, { invoiceId: 'a/b' }))?.status).toBe(400);
      expect(await run(op, { invoiceId: 'INV-404', deleteCode: '4321', discountAmount: 1, amount: 1, index: 0, paymentDate: 'd' }))
        .toEqual({ status: 409, body: { error: 'Invoice INV-404 not found.' } });
    }
    expect(codeChecks).toEqual([]);
  });
});

describe('updateInvoiceDiscount', () => {
  it('changes the total and what is owed, the ledger row and the order with it, and asks no code', async () => {
    put('invoices', 'INV-1', invoice({ sourceOrderId: 'ORD-1' }));
    put('hisaab', 'h1', { linkedInvoiceId: 'INV-1', cashDebit: 40_000 });
    put('orders', 'ORD-1', { grandTotal: 40_000 });
    const r = await run('updateInvoiceDiscount', { invoiceId: 'INV-1', discountAmount: 5_000, seen: { grandTotal: 100_000, amountPaid: 60_000 } });
    expect(r?.status).toBe(200);
    expect(r?.body.invoice).toMatchObject({ id: 'INV-1', discountAmount: 5_000, grandTotal: 95_000, balanceDue: 35_000 });
    expect(col('invoices')['INV-1']).toMatchObject({ discountAmount: 5_000, grandTotal: 95_000, balanceDue: 35_000 });
    expect(col('hisaab').h1).toMatchObject({ cashDebit: 35_000 });
    expect(col('orders')['ORD-1']).toEqual({ grandTotal: 35_000 });
    expect(logged.map((l) => l[1])).toEqual(['Discount updated on invoice INV-1']);
    expect(codeChecks).toEqual([]);
    expect(r?.body.followUps).toEqual([]);
  });

  it('refuses what the page refuses, a figure of the wrong shape, and writes nothing', async () => {
    put('invoices', 'INV-1', invoice());
    expect(await run('updateInvoiceDiscount', { invoiceId: 'INV-1', discountAmount: 100_001 })).toEqual({ status: 400, body: { error: 'Discount cannot exceed subtotal.' } });
    expect(await run('updateInvoiceDiscount', { invoiceId: 'INV-1', discountAmount: -1 })).toEqual({ status: 400, body: { error: 'Discount cannot be negative.' } });
    for (const discountAmount of ['5000', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await run('updateInvoiceDiscount', { invoiceId: 'INV-1', discountAmount })).toEqual({ status: 400, body: { error: 'Enter the discount.' } });
    }
    expect(col('invoices')['INV-1']).toMatchObject({ discountAmount: 0, grandTotal: 100_000 });
  });

  it('an invoice moved since the phone worked it out is not changed: look again', async () => {
    put('invoices', 'INV-1', invoice({ amountPaid: 70_000 }));
    expect(await run('updateInvoiceDiscount', { invoiceId: 'INV-1', discountAmount: 5_000, seen: { grandTotal: 100_000, amountPaid: 60_000 } }))
      .toEqual({ status: 409, body: { error: 'This invoice has changed since it was opened. Look at it again and try once more.' } });
    expect((await run('updateInvoiceDiscount', { invoiceId: 'INV-1', discountAmount: 5_000, seen: { grandTotal: '100000' } }))?.status).toBe(400);
    expect(col('invoices')['INV-1']).toMatchObject({ discountAmount: 0 });
  });
});

describe('deleteInvoicePayment', () => {
  const ask = { invoiceId: 'INV-1', index: 0, amount: 30_000, paymentDate: '2026-09-25' };

  it('asks the code in the store\'s words; a wrong one deletes nothing', async () => {
    put('invoices', 'INV-1', invoice());
    expect(await run('deleteInvoicePayment', { ...ask, deleteCode: '1111' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect(codeChecks).toEqual([`Delete the payment of PKR ${(30_000).toLocaleString()} on INV-1`]);
    expect((col('invoices')['INV-1'].paymentHistory as unknown[]).length).toBe(2);
  });

  it('takes the payment off and owes it again, the ledger following', async () => {
    put('invoices', 'INV-1', invoice());
    put('hisaab', 'h1', { linkedInvoiceId: 'INV-1', cashDebit: 40_000 });
    const r = await run('deleteInvoicePayment', { ...ask, deleteCode: '4321' });
    expect(r?.status).toBe(200);
    expect(r?.body.removed).toEqual({ amount: 30_000, date: '2026-09-25', notes: 'Advance on order ORD-1' });
    expect(r?.body.invoice).toMatchObject({ amountPaid: 30_000, balanceDue: 70_000 });
    expect(col('invoices')['INV-1']).toMatchObject({ amountPaid: 30_000, balanceDue: 70_000 });
    expect(col('hisaab').h1).toMatchObject({ cashDebit: 70_000 });
    expect(logged.map((l) => l[1])).toEqual(['Payment deleted from invoice INV-1']);
  });

  it('a refund can be deleted too (its amount is below nothing)', async () => {
    put('invoices', 'INV-1', invoice({ paymentHistory: [{ amount: 60_000, date: 'd1' }, { amount: -5_000, date: 'd2', notes: 'Refund' }], amountPaid: 55_000, balanceDue: 45_000 }));
    const r = await run('deleteInvoicePayment', { invoiceId: 'INV-1', index: 1, amount: -5_000, paymentDate: 'd2', deleteCode: '4321' });
    expect(r?.body.invoice).toMatchObject({ amountPaid: 60_000, balanceDue: 40_000 });
  });

  it('a payment no longer where the page showed it is said before the code is asked', async () => {
    put('invoices', 'INV-1', invoice());
    for (const moved of [{ amount: 29_000 }, { paymentDate: '2026-09-26' }, { index: 5 }]) {
      expect(await run('deleteInvoicePayment', { ...ask, ...moved, deleteCode: '4321' }))
        .toEqual({ status: 409, body: { error: 'The payments on this invoice changed. Open it again and try once more.' } });
    }
    for (const wrong of [{ index: -1 }, { index: 0.5 }, { index: '0' }, { amount: '30000' }, { paymentDate: '' }, { paymentDate: 7 }]) {
      expect((await run('deleteInvoicePayment', { ...ask, ...wrong, deleteCode: '4321' }))?.status).toBe(400);
    }
    expect(codeChecks).toEqual([]);
  });
});

describe('refundInvoicePartial', () => {
  it('asks the code in the store\'s words; a wrong one refunds nothing', async () => {
    put('invoices', 'INV-1', invoice());
    expect(await run('refundInvoicePartial', { invoiceId: 'INV-1', amount: 1_500, deleteCode: '0000' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect(codeChecks).toEqual([`Refund PKR ${(1_500).toLocaleString()} on INV-1`]);
    expect((col('invoices')['INV-1'].paymentHistory as unknown[]).length).toBe(2);
  });

  it('records the refund, the customer owing it again, and tells Shopify the same amount', async () => {
    put('invoices', 'INV-1', invoice({ amountPaid: 100_000, balanceDue: 0, paymentHistory: [{ amount: 100_000, date: 'd' }] }));
    const r = await run('refundInvoicePartial', { invoiceId: 'INV-1', amount: 1_500, reason: '  damaged clasp ', deleteCode: '4321', seen: { grandTotal: 100_000, amountPaid: 100_000 } });
    expect(r?.status).toBe(200);
    expect(r?.body.invoice).toMatchObject({ amountPaid: 98_500, balanceDue: 1_500 });
    const history = col('invoices')['INV-1'].paymentHistory as { amount: number; notes: string }[];
    expect(history[1]).toMatchObject({ amount: -1_500, notes: 'Refund: damaged clasp' });
    expect(Object.values(col('hisaab'))).toEqual([expect.objectContaining({ entityId: 'c1', cashDebit: 1_500, linkedInvoiceId: 'INV-1' })]);
    expect(r?.body.followUps).toEqual([{ path: '/api/shopify/sync/invoice', body: { invoiceId: 'INV-1', action: 'refund', amount: 1_500, reason: 'damaged clasp' } }]);
    expect(logged.map((l) => l[0])).toEqual(['invoice.refund']);
  });

  it('no reason goes as none; a Shopify order\'s own invoice sends nothing back', async () => {
    put('invoices', 'SHOPIFY-1416', invoice({ amountPaid: 7_850, grandTotal: 7_850, paymentHistory: [{ amount: 7_850, date: 'd' }] }));
    const r = await run('refundInvoicePartial', { invoiceId: 'SHOPIFY-1416', amount: 850, reason: '   ', deleteCode: '4321' });
    expect(r?.status).toBe(200);
    expect((col('invoices')['SHOPIFY-1416'].paymentHistory as { notes: string }[])[1].notes).toBe('Refund');
    expect(r?.body.followUps).toEqual([]);
  });

  it('refuses nothing to refund, a reason that is not text, a refunded invoice, and one moved since', async () => {
    put('invoices', 'INV-1', invoice());
    for (const amount of [0, -5, '500', undefined]) {
      expect(await run('refundInvoicePartial', { invoiceId: 'INV-1', amount, deleteCode: '4321' })).toEqual({ status: 400, body: { error: 'Enter a refund amount greater than 0.' } });
    }
    expect((await run('refundInvoicePartial', { invoiceId: 'INV-1', amount: 5, reason: 7, deleteCode: '4321' }))?.status).toBe(400);
    expect((await run('refundInvoicePartial', { invoiceId: 'INV-1', amount: 5, deleteCode: '4321', seen: { grandTotal: 100_000, amountPaid: 1 } }))?.status).toBe(409);
    put('invoices', 'INV-2', invoice({ status: 'Refunded' }));
    expect(await run('refundInvoicePartial', { invoiceId: 'INV-2', amount: 5, deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'This invoice is refunded already.' } });
    expect(codeChecks).toEqual([]);
    expect((col('invoices')['INV-1'].paymentHistory as unknown[]).length).toBe(2);
  });
});

describe('deleteInvoice', () => {
  it('asks the code in the store\'s words; a wrong one deletes nothing', async () => {
    put('invoices', 'INV-1', invoice());
    expect(await run('deleteInvoice', { invoiceId: 'INV-1', deleteCode: '' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect(codeChecks).toEqual(['Delete invoice INV-1']);
    expect(col('invoices')['INV-1']).toBeDefined();
  });

  it('goes with its ledger rows and its order\'s link, its pieces back in stock unless another invoice sold them; Shopify cancels after', async () => {
    put('invoices', 'INV-2', invoice({ sourceOrderId: 'ORD-1', shopifyOrderId: 99_001, items: [
      { sku: 'RNG-001', name: 'Ruby ring', unitPrice: 60_000, isCustomPrice: true },
      { sku: 'BNG-002', name: 'Bangle' },
    ] }));
    put('invoices', 'INV-1', { items: [{ sku: 'BNG-002' }] });
    put('sold_products', 'RNG-001', { sku: 'RNG-001' });
    put('sold_products', 'BNG-002', { sku: 'BNG-002' });
    put('hisaab', 'h1', { linkedInvoiceId: 'INV-2', cashDebit: 40_000 });
    put('orders', 'ORD-1', { invoiceId: 'INV-2', status: 'Completed' });
    const r = await run('deleteInvoice', { invoiceId: 'INV-2', deleteCode: '4321' });
    expect(r?.status).toBe(200);
    expect(r?.body).toMatchObject({ ok: true, deleted: true, invoiceId: 'INV-2', restocked: ['RNG-001'], ledgerRows: 1, order: { id: 'ORD-1', invoiceId: null } });
    expect(col('invoices')['INV-2']).toBeUndefined();
    expect(col('products')['RNG-001']).toMatchObject({ sku: 'RNG-001', isCustomPrice: true, customPrice: 60_000 });
    expect(col('sold_products')['RNG-001']).toBeUndefined();
    expect(col('sold_products')['BNG-002']).toEqual({ sku: 'BNG-002' });
    expect(col('hisaab')).toEqual({});
    expect(col('orders')['ORD-1']).toEqual({ status: 'Completed' });
    expect(invoiceReads).toBe(1);
    expect(r?.body.followUps).toEqual([{ path: '/api/shopify/sync/invoice', body: { invoiceId: 'INV-2', shopifyOrderId: '99001', action: 'cancel' } }]);
    expect(logged).toEqual([['invoice.delete', 'Deleted invoice INV-2', 'Customer: Sakina Demo', 'INV-2']]);
  });
});
