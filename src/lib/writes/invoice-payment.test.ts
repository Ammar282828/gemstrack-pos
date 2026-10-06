import { describe, expect, it } from 'vitest';
import { mirrorShopifyOrder, recordInvoicePayment, removeInvoicePayment } from './invoice-payment';
import type { DbPort, TxCtx } from '@/lib/db-port';

/** An in-memory database that counts commits, so "one trip" is checked, not assumed. */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  let ids = 0;
  const stats = { transactions: 0, batches: 0, directWrites: 0, queries: 0 };
  const col = (c: string) => (data[c] ??= {});
  const db: DbPort = {
    async runTransaction(fn) {
      stats.transactions++;
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? { ...(structuredClone(d) as Record<string, unknown>), id } as never : null; },
        set(c, id, d) { writes.push(() => { col(c)[id] = { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      return out;
    },
    async queryEquals(c, field, value) {
      stats.queries++;
      return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...(d as Record<string, unknown>), id }) as never);
    },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...(d as Record<string, unknown>), id } as never) : null; },
    async add(c, d) { stats.directWrites++; const id = `id${++ids}`; col(c)[id] = d; return id; },
    async update(c, id, d) { stats.directWrites++; col(c)[id] = { ...col(c)[id], ...d }; },
    batch() { stats.batches++; return { set() {}, update() {}, delete() {}, async commit() {} }; },
    newId() { return `new${++ids}`; },
  };
  return { db, data, stats };
}

describe('recording a payment', () => {
  it('pays the invoice, moves the ledger and the order in one commit', async () => {
    const { db, data, stats } = fakeDb({
      invoices: { 'INV-1': { grandTotal: 100_000, amountPaid: 20_000, balanceDue: 80_000, customerId: 'c1', customerName: 'Sakina', sourceOrderId: 'ORD-1', paymentHistory: [{ amount: 20_000, date: 'x' }] } },
      hisaab: { h1: { linkedInvoiceId: 'INV-1', cashDebit: 80_000 }, h2: { linkedInvoiceId: 'INV-1', cashDebit: 80_000 }, h3: { linkedInvoiceId: 'INV-9', cashDebit: 5 } },
      orders: { 'ORD-1': { grandTotal: 80_000 } },
    });
    const out = await recordInvoicePayment(db, { invoiceId: 'INV-1', amount: 30_000, date: '2026-10-01', method: 'Cash' });
    expect(out.balanceDue).toBe(50_000);
    expect(data.invoices['INV-1']).toMatchObject({ amountPaid: 50_000, balanceDue: 50_000 });
    expect(data.hisaab.h1).toMatchObject({ cashDebit: 50_000 });
    expect(data.hisaab.h2).toBeUndefined();          // a duplicate row goes
    expect(data.hisaab.h3).toMatchObject({ cashDebit: 5 }); // another invoice's row is untouched
    expect(data.orders['ORD-1']).toMatchObject({ grandTotal: 50_000 });
    expect(stats).toEqual({ transactions: 1, batches: 0, directWrites: 0, queries: 1 });
  });

  it('paid in full clears the ledger; an invoice with no row gets one only while owing', async () => {
    const { db, data } = fakeDb({
      invoices: { 'INV-2': { grandTotal: 10_000, amountPaid: 0, balanceDue: 10_000, customerId: 'c2', paymentHistory: [] } },
      hisaab: { h1: { linkedInvoiceId: 'INV-2', cashDebit: 10_000 } },
    });
    await recordInvoicePayment(db, { invoiceId: 'INV-2', amount: 10_000, date: 'd' });
    expect(data.hisaab.h1).toBeUndefined();

    const two = fakeDb({ invoices: { 'INV-3': { grandTotal: 10_000, amountPaid: 0, balanceDue: 10_000, customerId: 'c3', paymentHistory: [] } } });
    await recordInvoicePayment(two.db, { invoiceId: 'INV-3', amount: 4_000, date: 'd' });
    expect(Object.values(two.data.hisaab)).toEqual([expect.objectContaining({ linkedInvoiceId: 'INV-3', cashDebit: 6_000, entityId: 'c3' })]);
  });
});

describe('deleting a payment', () => {
  it('takes it off, puts the balance back on the ledger and the order, in one commit', async () => {
    const { db, data, stats } = fakeDb({
      invoices: { 'INV-1': { grandTotal: 288_250, amountPaid: 288_250, balanceDue: 0, customerId: 'c1', customerName: 'Fatima', sourceOrderId: 'ORD-1',
        paymentHistory: [{ amount: 30_000, date: '2026-09-25', notes: 'Advance on order ORD-1' }, { amount: 258_250, date: '2026-09-30', method: 'Cash' }] } },
      orders: { 'ORD-1': { grandTotal: 0 } },
    });
    const out = await removeInvoicePayment(db, { invoiceId: 'INV-1', index: 0, amount: 30_000, date: '2026-09-25' });
    expect(out.removed.notes).toBe('Advance on order ORD-1');
    expect(data.invoices['INV-1']).toMatchObject({ amountPaid: 258_250, balanceDue: 30_000 });
    expect((data.invoices['INV-1'].paymentHistory as unknown[]).length).toBe(1);
    expect(Object.values(data.hisaab)).toEqual([expect.objectContaining({ entityId: 'c1', cashDebit: 30_000, linkedInvoiceId: 'INV-1' })]);
    expect(data.orders['ORD-1']).toMatchObject({ grandTotal: 30_000 });
    expect(stats.transactions).toBe(1);
  });

  it("a walk-in's paid invoice owing again gets the walk-in row it would have had", async () => {
    const { db, data } = fakeDb({ invoices: { 'INV-2': { grandTotal: 1_000, amountPaid: 1_000, balanceDue: 0, customerName: 'Walk-in Customer', paymentHistory: [{ amount: 1_000, date: 'd' }] } } });
    await removeInvoicePayment(db, { invoiceId: 'INV-2', index: 0, amount: 1_000, date: 'd' });
    expect(Object.values(data.hisaab)).toEqual([expect.objectContaining({ entityId: 'walk-in', cashDebit: 1_000 })]);
  });

  it('refuses when the invoice changed since the page showed it', async () => {
    const { db, data } = fakeDb({ invoices: { 'INV-3': { grandTotal: 1_000, amountPaid: 500, balanceDue: 500, paymentHistory: [{ amount: 500, date: 'd' }] } } });
    await expect(removeInvoicePayment(db, { invoiceId: 'INV-3', index: 0, amount: 400, date: 'd' })).rejects.toThrow(/changed/);
    expect(data.invoices['INV-3']).toMatchObject({ amountPaid: 500 });
  });
});

describe("Shopify's word on a web order", () => {
  const order = { id: 9001, order_number: 1416, financial_status: 'paid', fulfillment_status: 'fulfilled', cancelled_at: null };
  const cod = { id: 77, kind: 'sale', status: 'success', amount: '7850.00', gateway: 'Cash on Delivery (COD)', processed_at: '2026-09-16T12:12:00Z' };

  it('adds a payment Shopify took, once, as a bank payment, and clears the ledger', async () => {
    const { db, data, stats } = fakeDb({
      invoices: { 'SHOPIFY-1416': { grandTotal: 7_850, amountPaid: 0, balanceDue: 7_850, customerId: 'shopify-5', items: [{ karigarId: 'k1', metalType: 'silver' }], paymentHistory: [] } },
      hisaab: { h1: { linkedInvoiceId: 'SHOPIFY-1416', cashDebit: 7_850 } },
    });
    const out = await mirrorShopifyOrder(db, 'SHOPIFY-1416', order, [cod]);
    expect(out).toMatchObject({ changed: true, balanceDue: 0 });
    const inv = data.invoices['SHOPIFY-1416'];
    expect(inv).toMatchObject({ amountPaid: 7_850, balanceDue: 0, shopifyFinancialStatus: 'paid', shopifyFulfillment: 'fulfilled', shopifyTransactionIds: ['77'] });
    expect(inv.paymentHistory).toEqual([{ amount: 7_850, date: '2026-09-16T12:12:00Z', notes: 'Paid on Shopify (Order #1416, Cash on Delivery (COD))', method: 'Bank Transfer', reference: 'Shopify #1416' }]);
    expect(inv.items).toEqual([{ karigarId: 'k1', metalType: 'silver' }]); // what the shop added is left alone
    expect(data.hisaab.h1).toBeUndefined();
    expect(stats.transactions).toBe(1);

    // The same notice again — Mina's store sends each one to two addresses — adds nothing.
    const again = await mirrorShopifyOrder(db, 'SHOPIFY-1416', order, [cod]);
    expect(again).toMatchObject({ changed: false, added: [] });
    expect((data.invoices['SHOPIFY-1416'].paymentHistory as unknown[]).length).toBe(1);
  });

  it('never takes twice what the counter already took, and never lowers what is paid', async () => {
    const { db, data } = fakeDb({ invoices: {
      'SHOPIFY-1': { grandTotal: 7_850, amountPaid: 7_850, balanceDue: 0, paymentHistory: [{ amount: 7_850, date: 'd', method: 'Cash' }] },
      // An import from before the history was kept: paid, with no payments listed.
      'SHOPIFY-2': { grandTotal: 5_000, amountPaid: 5_000, balanceDue: 0, paymentHistory: [] },
    } });
    await mirrorShopifyOrder(db, 'SHOPIFY-1', order, [cod]);
    expect(data.invoices['SHOPIFY-1']).toMatchObject({ amountPaid: 7_850, balanceDue: 0, shopifyTransactionIds: ['77'] });
    expect((data.invoices['SHOPIFY-1'].paymentHistory as unknown[]).length).toBe(1);
    await mirrorShopifyOrder(db, 'SHOPIFY-2', { ...order, fulfillment_status: null }, []);
    expect(data.invoices['SHOPIFY-2']).toMatchObject({ amountPaid: 5_000, balanceDue: 0, shopifyFulfillment: 'unfulfilled' });
    // Its Shopify payment, when there is one, becomes the record of that 5,000 — dated, by method — and nothing more.
    await mirrorShopifyOrder(db, 'SHOPIFY-2', order, [{ id: 8, kind: 'sale', status: 'success', amount: '5000', gateway: 'Safepay Checkout Onsite', processed_at: '2026-09-12T10:00:00Z' }]);
    expect(data.invoices['SHOPIFY-2']).toMatchObject({ amountPaid: 5_000, balanceDue: 0, paymentHistory: [expect.objectContaining({ amount: 5_000, method: 'Card', date: '2026-09-12T10:00:00Z' })] });
  });

  it('fills only what is owed; refunds, failures and authorisations are not payments', async () => {
    const { db, data } = fakeDb({ invoices: { 'SHOPIFY-3': { grandTotal: 10_000, amountPaid: 4_000, balanceDue: 6_000, customerId: 'shopify-1', paymentHistory: [{ amount: 4_000, date: 'd' }] } } });
    await mirrorShopifyOrder(db, 'SHOPIFY-3', { ...order, order_number: 3 }, [
      { id: 1, kind: 'authorization', status: 'success', amount: '10000', gateway: 'Safepay Checkout Onsite' },
      { id: 2, kind: 'capture', status: 'success', amount: '10000', gateway: 'Safepay Checkout Onsite', processed_at: '2026-09-02' },
      { id: 3, kind: 'sale', status: 'failure', amount: '10000' },
      { id: 4, kind: 'refund', status: 'success', amount: '500' },
    ]);
    const inv = data.invoices['SHOPIFY-3'];
    expect(inv).toMatchObject({ amountPaid: 10_000, balanceDue: 0, shopifyTransactionIds: ['2'] });
    expect((inv.paymentHistory as { amount: number; method?: string }[])[1]).toMatchObject({ amount: 6_000, method: 'Card' });
  });

  it('a cancelled order is marked, and its invoice not otherwise touched', async () => {
    const { db, data } = fakeDb({ invoices: { 'SHOPIFY-4': { grandTotal: 4_350, amountPaid: 0, balanceDue: 4_350, paymentHistory: [] } } });
    await mirrorShopifyOrder(db, 'SHOPIFY-4', { ...order, financial_status: 'voided', fulfillment_status: null, cancelled_at: '2026-09-19T09:07:00Z' }, []);
    expect(data.invoices['SHOPIFY-4']).toMatchObject({ balanceDue: 4_350, shopifyFinancialStatus: 'voided', shopifyCancelledAt: '2026-09-19T09:07:00Z' });
  });

  it('a web sale cancelled with nothing paid is voided; with money taken, or a checkout link, only marked', async () => {
    const cancelled = { ...order, financial_status: 'voided', cancelled_at: '2026-09-23T10:43:00Z' };
    const { db, data } = fakeDb({
      invoices: {
        'SHOPIFY-1406': { grandTotal: 11_850, amountPaid: 0, balanceDue: 11_850, customerId: 'shopify-7', paymentHistory: [] },
        'SHOPIFY-7': { grandTotal: 5_000, amountPaid: 2_000, balanceDue: 3_000, paymentHistory: [{ amount: 2_000, date: 'd', method: 'Cash' }] },
        'INV-000300': { grandTotal: 9_000, amountPaid: 0, balanceDue: 9_000, paymentHistory: [] },
      },
      hisaab: { h1: { linkedInvoiceId: 'SHOPIFY-1406', cashDebit: 11_850 } },
    });
    const out = await mirrorShopifyOrder(db, 'SHOPIFY-1406', cancelled, [], {}, {}, { voidWhenCancelled: true });
    expect(out).toMatchObject({ voided: true });
    expect(data.invoices['SHOPIFY-1406']).toMatchObject({ status: 'Refunded', refundedAt: '2026-09-23T10:43:00Z', shopifyCancelledAt: '2026-09-23T10:43:00Z' });
    expect(data.hisaab.h1).toBeUndefined();
    expect(await mirrorShopifyOrder(db, 'SHOPIFY-1406', cancelled, [], {}, {}, { voidWhenCancelled: true })).toMatchObject({ changed: false });

    await mirrorShopifyOrder(db, 'SHOPIFY-7', cancelled, [], {}, {}, { voidWhenCancelled: true });
    expect(data.invoices['SHOPIFY-7'].status).toBeUndefined();
    expect(data.invoices['SHOPIFY-7']).toMatchObject({ shopifyCancelledAt: '2026-09-23T10:43:00Z', amountPaid: 2_000 });

    await mirrorShopifyOrder(db, 'INV-000300', cancelled, []);
    expect(data.invoices['INV-000300'].status).toBeUndefined();
  });

  it('an invoice the ERP does not have is left alone', async () => {
    const { db, data } = fakeDb({ invoices: {} });
    expect(await mirrorShopifyOrder(db, 'SHOPIFY-5', order, [cod])).toBeNull();
    expect(data.invoices).toEqual({});
  });
});
