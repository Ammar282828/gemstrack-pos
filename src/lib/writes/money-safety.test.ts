import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { recordInvoicePayment } from './invoice-payment';
import { recordOrderAdvance } from './order-advance';
import { recordRepairPayment } from './repairs';
import { reconcileOrderMoney, updateOrder } from './update-order';
import { createOrder } from './create-order';
import { deleteInvoice } from './invoice-delete';
import { cleanObject } from './create-invoice';

type Seed = Record<string, Record<string, Record<string, unknown>>>;

/** An in-memory database; `onQuery` lets a test land another phone's write in the middle of an operation. */
function fakeDb(seed: Seed, onQuery?: (data: Seed) => void) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  let ids = 0;
  const db: DbPort = {
    async runTransaction(fn) {
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      return out;
    },
    async queryEquals(c, field, value) {
      onQuery?.(data);
      return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...structuredClone(d), id }) as never);
    },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { col(c)[id] = { ...col(c)[id], ...d }; },
    batch() {
      const writes: (() => void)[] = [];
      return {
        set(c, id, d, merge) { writes.push(() => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
        async commit() { writes.forEach(w => w()); },
      };
    },
    newId() { return `n${++ids}`; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

describe('a payment appended once, whatever path it takes', () => {
  const invoices = (): Seed => ({ invoices: { 'INV-1': { grandTotal: 100_000, amountPaid: 0, balanceDue: 100_000, customerId: 'c1', customerName: 'Demo', paymentHistory: [] } } });

  it('the same request again appends nothing and logs nothing', async () => {
    const { db, data } = fakeDb(invoices());
    const logs: string[] = [];
    const input = { invoiceId: 'INV-1', amount: 40_000, date: '2026-10-01', requestId: 'req-pay-0001' };
    await recordInvoicePayment(db, input, { log: (a) => { logs.push(a); } });
    const again = await recordInvoicePayment(db, input, { log: (a) => { logs.push(a); } });
    expect((data.invoices['INV-1'].paymentHistory as { id?: string }[]).map(p => p.id)).toEqual(['pay-req-pay-0001']);
    expect(data.invoices['INV-1'].amountPaid).toBe(40_000);
    expect(again.amountPaid).toBe(40_000);
    expect(logs).toEqual(['invoice.payment']);
  });

  it('two separate payments of one amount (different requests) are both kept', async () => {
    const { db, data } = fakeDb(invoices());
    await recordInvoicePayment(db, { invoiceId: 'INV-1', amount: 5_000, date: '2026-10-01', requestId: 'req-pay-0001' });
    await recordInvoicePayment(db, { invoiceId: 'INV-1', amount: 5_000, date: '2026-10-01', requestId: 'req-pay-0002' });
    expect(data.invoices['INV-1'].amountPaid).toBe(10_000);
  });

  it('an advance and a repair payment likewise', async () => {
    const { db, data } = fakeDb({
      orders: { 'ORD-1': { subtotal: 50_000, advancePayment: 0, advances: [] } },
      repairs: { 'REP-1': { payments: [], customerName: 'Demo' } },
    });
    for (let i = 0; i < 2; i++) await recordOrderAdvance(db, { orderId: 'ORD-1', amount: 5_000, requestId: 'req-adv-0001' });
    expect(data.orders['ORD-1'].advancePayment).toBe(5_000);
    expect((data.orders['ORD-1'].advances as unknown[]).length).toBe(1);
    for (let i = 0; i < 2; i++) await recordRepairPayment(db, 'REP-1', { id: 'pay-req-rep-0001', amount: 700, date: '2026-10-01' });
    expect((data.repairs['REP-1'].payments as unknown[]).length).toBe(1);
    expect(Object.keys(data.extra_revenue ?? {}).length).toBeLessThanOrEqual(1);
  });

  it('refuses an amount that is not a sane figure, and a date that is not a date', async () => {
    const { db, data } = fakeDb(invoices());
    for (const amount of [1e308, -5, NaN, 0, 2e10]) {
      await expect(recordInvoicePayment(db, { invoiceId: 'INV-1', amount, date: '2026-10-01' })).rejects.toThrow(/payment must be/);
    }
    for (const date of ['yesterday', '', '2026-13-45', '31/12/2026']) {
      await expect(recordInvoicePayment(db, { invoiceId: 'INV-1', amount: 1, date })).rejects.toThrow(/date/);
    }
    await expect(recordOrderAdvance(db, { orderId: 'ORD-1', amount: 1e308 })).rejects.toThrow(/advance must be/);
    expect(data.invoices['INV-1'].amountPaid).toBe(0);
  });
});

describe('editing an order never puts a stale form over money another phone took', () => {
  const stored = (): Seed => ({
    orders: { 'ORD-1': { status: 'Pending', customerName: 'Before', subtotal: 50_000, discountAmount: 0, advancePayment: 0, grandTotal: 50_000, advances: [], items: [{ description: 'A' }] } },
  });
  const clean = <T extends object>(o: T) => cleanObject(o);
  // What the form (opened with no advance) sends back when saved.
  const staleForm = { customerName: 'After', subtotal: 50_000, discountAmount: 0, advancePayment: 0, grandTotal: 50_000, items: [{ description: 'A' }] };

  it('phone B records an advance while A has the form open: A saves, the advance and the balance stand', async () => {
    const { db, data } = fakeDb(stored());
    await recordOrderAdvance(db, { orderId: 'ORD-1', amount: 5_000, date: '2026-10-02T10:00:00.000Z' });
    await updateOrder(db, { orderId: 'ORD-1', edit: staleForm as never }, { clean });
    const o = data.orders['ORD-1'];
    expect(o.customerName).toBe('After');
    expect(o.advancePayment).toBe(5_000);
    expect(o.grandTotal).toBe(45_000);
    expect((o.advances as unknown[]).length).toBe(1);
  });

  it('more advance typed than is stored is more money taken, joined to the history; the total follows', async () => {
    const { db, data } = fakeDb(stored());
    await recordOrderAdvance(db, { orderId: 'ORD-1', amount: 5_000 });
    const out = await updateOrder(db, { orderId: 'ORD-1', edit: { ...staleForm, advancePayment: 7_000 } as never }, { clean });
    expect(out.addedAdvance?.amount).toBe(2_000);
    expect(data.orders['ORD-1'].advancePayment).toBe(7_000);
    expect(data.orders['ORD-1'].grandTotal).toBe(43_000);
    expect((data.orders['ORD-1'].advances as unknown[]).length).toBe(2);
  });

  it('a discount edit recomputes the balance from the stored advance', async () => {
    const { db, data } = fakeDb(stored());
    await recordOrderAdvance(db, { orderId: 'ORD-1', amount: 5_000 });
    await updateOrder(db, { orderId: 'ORD-1', edit: { ...staleForm, discountAmount: 2_000 } as never }, { clean });
    expect(data.orders['ORD-1'].grandTotal).toBe(43_000);
  });

  it('an invoiced order keeps its balance and advance: the invoice is where money is taken', () => {
    const out = reconcileOrderMoney({ invoiceId: 'INV-1', advancePayment: 9, grandTotal: 1 }, { advancePayment: 0, grandTotal: 50_000, customerName: 'X' });
    expect(out).toEqual({ customerName: 'X' });
  });
});

describe('creating an order takes known fields only, with sane figures', () => {
  const base = (over: Record<string, unknown> = {}) => ({
    items: [{ description: 'Ring', makingCharges: 1_000 }], customerName: 'Walk-in Customer', subtotal: 10_000, grandTotal: 10_000, advancePayment: 0, ...over,
  });
  const deps = { createCustomer: async () => null, clean: cleanObject };
  const seed = (): Seed => ({ app_settings: { global: { lastOrderNumber: 7, goldRatePerGram21k: 30_000 } } });

  it('drops what is the server\'s to set', async () => {
    const { db, data } = fakeDb(seed());
    const made = await createOrder(db, base({
      status: 'Completed', invoiceId: 'INV-9', shareToken: 'tok', shopifyDraftOrderId: 'd1', payments: [{ amount: 9 }], isPaid: true, id: 'ORD-HACK', createdAt: '1999-01-01',
    }) as never, deps);
    expect(made.id).toBe('ORD-000008');
    const o = data.orders['ORD-000008'];
    expect(o.status).toBe('Pending');
    for (const k of ['invoiceId', 'shareToken', 'shopifyDraftOrderId', 'payments', 'isPaid']) expect(o).not.toHaveProperty(k);
    expect(o.createdAt).not.toBe('1999-01-01');
    expect(data.orders['ORD-HACK']).toBeUndefined();
  });

  it('refuses negative, non-finite or huge figures and a bad date, writing nothing', async () => {
    const { db, data } = fakeDb(seed());
    for (const over of [{ subtotal: -1 }, { advancePayment: NaN }, { discountAmount: 1e12 }, { grandTotal: 1e308 }, { promisedDate: 'soon' }, { advanceInExchangeValue: -3 },
      { items: [{ description: 'x', makingCharges: -1 }] }, { advances: [{ amount: 5, date: 'tomorrow' }] }]) {
      await expect(createOrder(db, base(over) as never, deps)).rejects.toThrow(/must be|date|piece/i);
    }
    expect(data.orders).toBeUndefined();
    expect(data.app_settings.global.lastOrderNumber).toBe(7);
  });

  it('keeps what the forms send: a promised day, delivery, the website\'s meta, a negative balance past the pieces', async () => {
    const { db, data } = fakeDb(seed());
    await createOrder(db, base({ promisedDate: '2026-11-01', delivery: { required: true, address: 'x' }, website: { token: 't' }, grandTotal: -2_000, advances: [{ amount: 500, date: '2026-10-01T00:00:00.000Z', method: 'Cash' }] }) as never, deps);
    const o = data.orders['ORD-000008'];
    expect(o).toMatchObject({ promisedDate: '2026-11-01', delivery: { required: true }, website: { token: 't' }, grandTotal: -2_000 });
  });
});

describe('deleting an invoice', () => {
  const seed = (): Seed => ({
    invoices: { 'INV-1': { customerName: 'Demo', customerId: 'c1', grandTotal: 100_000, amountPaid: 60_000, balanceDue: 40_000, items: [], paymentHistory: [{ id: 'p1', amount: 60_000, date: '2026-10-01' }] } },
    hisaab: { h1: { linkedInvoiceId: 'INV-1', cashDebit: 40_000 } },
  });
  const deps = { deleteField: () => null, invoices: () => [] };

  it('leaves a tombstone with the amounts, payments and ledger rows, in the same transaction', async () => {
    const { db, data } = fakeDb(seed());
    const logs: string[][] = [];
    await deleteInvoice(db, { invoiceId: 'INV-1', by: 'owner@example.com' }, deps, { log: (...a: (string | undefined)[]) => { logs.push(a as string[]); } });
    expect(data.invoices['INV-1']).toBeUndefined();
    expect(data.deleted_invoices['INV-1']).toMatchObject({
      invoiceId: 'INV-1', deletedBy: 'owner@example.com', grandTotal: 100_000, amountPaid: 60_000, balanceDue: 40_000,
      ledgerRows: [{ id: 'h1', cashDebit: 40_000 }], invoice: { paymentHistory: [{ id: 'p1', amount: 60_000 }] },
    });
    expect(logs[0][2]).toContain('Total: 100,000');
  });

  it('a payment landing between the read and the commit stops the delete: that money is not buried', async () => {
    let landed = false;
    const { db, data } = fakeDb(seed(), (d) => {
      if (landed) return;
      landed = true;
      d.invoices['INV-1'].amountPaid = 100_000;
      d.invoices['INV-1'].balanceDue = 0;
      (d.invoices['INV-1'].paymentHistory as unknown[]).push({ id: 'p2', amount: 40_000, date: '2026-10-02' });
    });
    await expect(deleteInvoice(db, { invoiceId: 'INV-1' }, deps)).rejects.toThrow(/has changed since/);
    expect(data.invoices['INV-1']).toBeDefined();
    expect(data.deleted_invoices).toBeUndefined();
  });
});
