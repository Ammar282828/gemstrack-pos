import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { convertBlocker } from '@/lib/shopify-orders';
import { convertAllShopifyInvoices, conversionFor, orderIdForInvoice, shopifyInvoicesToOrders, type ShopifyConvertDeps } from './shopify-invoice-to-order';

const REMOVE = '<removed>';
type Data = Record<string, Record<string, Record<string, unknown>>>;

function fakeDb(seed: Data) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
    const next = merge ? { ...col(c)[id], ...d } : { ...d };
    for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
    col(c)[id] = next;
  };
  const db: DbPort = {
    async runTransaction(fn) {
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => put(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach(w => w());
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
        async commit() { writes.forEach(w => w()); },
      };
    },
    newId() { return 'n'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

const deps: ShopifyConvertDeps = {
  createCustomer: async () => null,
  clean: <T extends object>(o: T) => JSON.parse(JSON.stringify(o)) as T,
  deleteField: () => REMOVE,
  by: 'owner@example.com',
};

const settings = { lastOrderNumber: 41, goldRatePerGram24k: 1, goldRatePerGram22k: 1, goldRatePerGram21k: 1, goldRatePerGram18k: 1, silverRatePerGram: 1 };
const invoice = (id: string, o: Record<string, unknown> = {}) => ({
  id, source: 'shopify', customerId: 'shopify-9', customerName: 'Sara Ali', customerContact: '+923001234567',
  createdAt: '2026-10-20T10:00:00.000Z', subtotal: 6000, discountAmount: 500, adjustmentsAmount: 0, grandTotal: 5500,
  amountPaid: 2000, balanceDue: 3500,
  items: [
    { sku: 'SHOPIFY-1', name: 'Ring', quantity: 2, unitPrice: 2500, itemTotal: 5000, metalType: 'silver' },
    { sku: 'SHOPIFY-2', name: 'Chain', quantity: 1, unitPrice: 1000, itemTotal: 1000, metalType: 'silver' },
  ],
  paymentHistory: [{ id: 'pay-a', amount: 1500, date: '2026-10-20T11:00:00.000Z', method: 'Bank Transfer' }, { amount: 500, date: '2026-10-21T11:00:00.000Z' }],
  shopifyOrderId: '7445', shopifyOrderNumber: 1440, shopifyOrderName: '#1440', shopifyFinancialStatus: 'partially_paid',
  shopifyFulfillment: 'unfulfilled', shopifyTransactionIds: ['t1', 't2'], whatsappOrder: { state: 'awaiting-confirmation', at: '2026-10-20T10:05:00.000Z' },
  ...o,
});
const seed = (...inv: Record<string, unknown>[]): Data => ({
  app_settings: { global: { ...settings } },
  invoices: Object.fromEntries(inv.map(i => [i.id as string, i])),
  customers: { 'shopify-9': { id: 'shopify-9', name: 'Sara Ali' } },
});

describe('convertBlocker', () => {
  it('accepts an open Shopify sale and refuses the rest', () => {
    expect(convertBlocker(invoice('A'))).toBeNull();
    expect(convertBlocker(invoice('A', { source: 'shopify_import', shopifyFulfillment: 'partial' }))).toBeNull();
    expect(convertBlocker(invoice('A', { shopifyFulfillment: null }))).toBeNull();
    expect(convertBlocker(invoice('A', { source: 'pos' }))).toMatch(/not a Shopify/);
    expect(convertBlocker(invoice('A', { sourceOrderId: 'ORD-1' }))).toMatch(/order already/);
    expect(convertBlocker(invoice('A', { status: 'Refunded' }))).toMatch(/cancelled/);
    expect(convertBlocker(invoice('A', { shopifyCancelledAt: '2026-10-21' }))).toMatch(/cancelled/);
    expect(convertBlocker(invoice('A', { shopifyFulfillment: 'fulfilled' }))).toMatch(/fulfilled/);
    expect(convertBlocker(invoice('A', { paymentHistory: [{ amount: -100, date: 'x' }] }))).toMatch(/refund/);
  });
});

describe('shopifyInvoicesToOrders', () => {
  it('makes the order from the invoice, its payments advances, and removes the invoice and its hisaab rows', async () => {
    const { db, data } = fakeDb({
      ...seed(invoice('SHOPIFY-1440')),
      hisaab: { h1: { linkedInvoiceId: 'SHOPIFY-1440', amount: 3500 }, h2: { linkedInvoiceId: 'OTHER' } },
      products: {}, sold_products: {},
    });
    const logs: string[] = [];
    const out = await shopifyInvoicesToOrders(db, ['SHOPIFY-1440'], deps, { log: (a, t) => { logs.push(`${a}:${t}`); } });
    expect(out).toEqual({ converted: [{ invoiceId: 'SHOPIFY-1440', orderId: 'SHOPIFY-1440' }], skipped: [] });
    const o = data.orders['SHOPIFY-1440'] as Record<string, unknown> & { items: Record<string, unknown>[]; advances: Record<string, unknown>[] };
    expect(o).toMatchObject({
      status: 'Pending', source: 'shopify', customerId: 'shopify-9', customerName: 'Sara Ali',
      subtotal: 6000, discountAmount: 500, advancePayment: 2000, grandTotal: 3500,
      createdAt: '2026-10-20T10:00:00.000Z', shopifyOrderId: '7445', shopifyOrderNumber: 1440, shopifyOrderName: '#1440',
      shopifyFinancialStatus: 'partially_paid', shopifyFulfillment: 'unfulfilled', shopifyTransactionIds: ['t1', 't2'],
      whatsappOrder: { state: 'awaiting-confirmation' }, convertedFromInvoiceId: 'SHOPIFY-1440',
    });
    expect(o.items.map(i => [i.description, i.manualPrice])).toEqual([['Ring', 2500], ['Ring', 2500], ['Chain', 1000]]);
    expect(o.advances).toEqual([
      { id: 'adv-from-SHOPIFY-1440-pay-a', amount: 1500, date: '2026-10-20T11:00:00.000Z', method: 'Bank Transfer' },
      { id: 'adv-from-SHOPIFY-1440-1', amount: 500, date: '2026-10-21T11:00:00.000Z' },
    ]);
    // The invoice is gone through Delete invoice's path: tombstone kept, its ledger row gone, others untouched, no phantom stock.
    expect(data.invoices['SHOPIFY-1440']).toBeUndefined();
    expect((data.deleted_invoices['SHOPIFY-1440'] as { deletedBy: string }).deletedBy).toBe('owner@example.com');
    expect(Object.keys(data.hisaab)).toEqual(['h2']);
    expect(Object.keys(data.products)).toEqual([]);
    expect(data.app_settings.global.lastOrderNumber).toBe(41);
    expect(logs).toEqual(['order.create:Converted to order: SHOPIFY-1440']);
  });

  it('uses SHOPIFY-INV-<id> with no Shopify number', async () => {
    expect(orderIdForInvoice({ id: 'INV-9' })).toBe('SHOPIFY-INV-INV-9');
    const { db, data } = fakeDb(seed(invoice('INV-000009', { shopifyOrderNumber: undefined, shopifyOrderName: undefined, paymentHistory: [], amountPaid: 0 })));
    const out = await shopifyInvoicesToOrders(db, ['INV-000009'], deps);
    expect(out.converted).toEqual([{ invoiceId: 'INV-000009', orderId: 'SHOPIFY-INV-INV-000009' }]);
    expect(data.orders['SHOPIFY-INV-INV-000009']).toMatchObject({ advancePayment: 0, grandTotal: 5500 });
  });

  it('is idempotent: the same call again converts nothing twice and doubles no advance', async () => {
    const { db, data } = fakeDb(seed(invoice('SHOPIFY-1440')));
    await shopifyInvoicesToOrders(db, ['SHOPIFY-1440'], deps);
    const again = await shopifyInvoicesToOrders(db, ['SHOPIFY-1440'], deps);
    expect(again).toEqual({ converted: [{ invoiceId: 'SHOPIFY-1440', orderId: 'SHOPIFY-1440' }], skipped: [] });
    expect(Object.keys(data.orders)).toEqual(['SHOPIFY-1440']);
    expect((data.orders['SHOPIFY-1440'].advances as unknown[]).length).toBe(2);
    expect(data.orders['SHOPIFY-1440'].advancePayment).toBe(2000);
  });

  it('finishes a half-done conversion (the order made, the invoice still there)', async () => {
    const { db, data } = fakeDb({ ...seed(invoice('SHOPIFY-1440')), orders: { 'SHOPIFY-1440': { id: 'SHOPIFY-1440', convertedFromInvoiceId: 'SHOPIFY-1440', advances: [{ id: 'adv-from-SHOPIFY-1440-pay-a' }], advancePayment: 2000 } } });
    const out = await shopifyInvoicesToOrders(db, ['SHOPIFY-1440'], deps);
    expect(out.converted).toHaveLength(1);
    expect(data.invoices['SHOPIFY-1440']).toBeUndefined();
    expect((data.orders['SHOPIFY-1440'].advances as unknown[]).length).toBe(1);
  });

  it('skips an invoice whose order exists already (the mirror made it) and leaves the invoice', async () => {
    const { db, data } = fakeDb({ ...seed(invoice('SHOPIFY-1440'), invoice('INV-2', { shopifyOrderNumber: 1500, shopifyOrderId: '8888' })), orders: { 'SHOPIFY-1440': { id: 'SHOPIFY-1440' }, 'SHOPIFY-9': { id: 'SHOPIFY-9', shopifyOrderId: '8888' } } });
    const out = await shopifyInvoicesToOrders(db, ['SHOPIFY-1440', 'INV-2'], deps);
    expect(out.converted).toEqual([]);
    expect(out.skipped).toEqual([{ invoiceId: 'SHOPIFY-1440', reason: 'already an order' }, { invoiceId: 'INV-2', reason: 'already an order' }]);
    expect(Object.keys(data.invoices)).toEqual(['SHOPIFY-1440', 'INV-2']);
    expect(data.orders['SHOPIFY-1440']).toEqual({ id: 'SHOPIFY-1440' });
  });

  it('skips fulfilled, cancelled, order-made and unknown invoices, and converts the rest', async () => {
    const { db, data } = fakeDb(seed(
      invoice('OK', { shopifyOrderNumber: 1 }),
      invoice('SHIPPED', { shopifyOrderNumber: 2, shopifyFulfillment: 'fulfilled' }),
      invoice('VOID', { shopifyOrderNumber: 3, status: 'Refunded' }),
      invoice('FROM-ORDER', { shopifyOrderNumber: 4, sourceOrderId: 'ORD-000001' }),
      invoice('POS', { source: 'pos' }),
    ));
    const out = await shopifyInvoicesToOrders(db, ['OK', 'SHIPPED', 'VOID', 'FROM-ORDER', 'POS', 'NOPE', 'OK'], deps);
    expect(out.converted).toEqual([{ invoiceId: 'OK', orderId: 'SHOPIFY-1' }]);
    expect(out.skipped.map(s => [s.invoiceId, s.reason])).toEqual([
      ['SHIPPED', 'already fulfilled'], ['VOID', 'cancelled or refunded'], ['FROM-ORDER', 'made from an order already'],
      ['POS', 'not a Shopify sale'], ['NOPE', 'no such invoice'],
    ]);
    expect(Object.keys(data.invoices).sort()).toEqual(['FROM-ORDER', 'POS', 'SHIPPED', 'VOID']);
    expect(Object.keys(data.orders)).toEqual(['SHOPIFY-1']);
  });
});

describe('every old Shopify sale an order', () => {
  it('decides by Shopify\'s word: shipped Completed, cancelled or returned Cancelled, open to the workshop, no word Completed', () => {
    expect(conversionFor(invoice('a') as never)).toBe('open');
    expect(conversionFor(invoice('a', { shopifyFulfillment: 'fulfilled' }) as never)).toBe('Completed');
    expect(conversionFor(invoice('a', { shopifyDelivery: 'in_transit', shopifyFulfillment: 'partial' }) as never)).toBe('Completed');
    expect(conversionFor(invoice('a', { status: 'Refunded' }) as never)).toBe('Cancelled');
    expect(conversionFor(invoice('a', { shopifyFulfillment: 'fulfilled', shopifyDelivery: 'returned' }) as never)).toBe('Cancelled');
    expect(conversionFor(invoice('a', { source: 'shopify_import', shopifyFulfillment: undefined }) as never)).toBe('Completed');
    expect(conversionFor(invoice('a', { sourceOrderId: 'ORD-1' }) as never)).toEqual({ skip: 'made from an order already' });
    expect(conversionFor(invoice('a', { exchanges: [{ value: 1 }] }) as never)).toEqual({ skip: 'has an exchange' });
  });

  it('open goes to the workshop (invoice made an order); shipped and cancelled keep their invoice beside a Completed / Cancelled order', async () => {
    const { db, data } = fakeDb(seed(
      invoice('SHOPIFY-1440'),
      invoice('SHOPIFY-1441', { shopifyOrderNumber: 1441, shopifyOrderId: '7446', shopifyOrderName: '#1441', shopifyFulfillment: 'fulfilled', shopifyDelivery: 'delivered', amountPaid: 5500, balanceDue: 0 }),
      invoice('SHOPIFY-1442', { shopifyOrderNumber: 1442, shopifyOrderId: '7447', shopifyOrderName: '#1442', status: 'Refunded', shopifyCancelledAt: '2026-10-29T13:46:41Z', amountPaid: 0, balanceDue: 0, paymentHistory: [] }),
      invoice('INV-000050', { source: 'shopify_import', shopifyOrderNumber: undefined, shopifyOrderId: undefined, shopifyOrderName: '#1001', shopifyFulfillment: undefined }),
    ));
    const r = await convertAllShopifyInvoices(db, deps);
    expect(r).toMatchObject({ seen: 4, open: ['SHOPIFY-1440'], completed: ['SHOPIFY-1441', 'SHOPIFY-1001'], cancelled: ['SHOPIFY-1442'], remaining: 0 });
    expect(data.invoices['SHOPIFY-1440']).toBeUndefined();
    expect(data.orders['SHOPIFY-1440']).toMatchObject({ status: 'Pending', advancePayment: 2000 });
    expect(data.invoices['SHOPIFY-1441']).toMatchObject({ sourceOrderId: 'SHOPIFY-1441', amountPaid: 5500 });
    const done = data.orders['SHOPIFY-1441'] as Record<string, unknown> & { items: { isCompleted: boolean }[] };
    expect(done).toMatchObject({ status: 'Completed', invoiceId: 'SHOPIFY-1441', advancePayment: 0, shopifyDelivery: 'delivered', source: 'shopify' });
    expect(done.items.every(i => i.isCompleted)).toBe(true);
    expect(data.orders['SHOPIFY-1442']).toMatchObject({ status: 'Cancelled', invoiceId: 'SHOPIFY-1442' });
    expect(data.invoices['SHOPIFY-1442']).toMatchObject({ status: 'Refunded', sourceOrderId: 'SHOPIFY-1442' });
    expect(data.app_settings.global.lastOrderNumber).toBe(41);
    // Again: nothing left to do.
    const again = await convertAllShopifyInvoices(db, deps);
    expect(again).toMatchObject({ seen: 0, open: [], completed: [], cancelled: [] });
  });

  it('works in batches: the rest wait for the next pass', async () => {
    const { db } = fakeDb(seed(...[1, 2, 3].map(n => invoice(`SHOPIFY-${n}`, { shopifyOrderNumber: n, shopifyOrderId: `${n}`, shopifyFulfillment: 'fulfilled' }))));
    expect(await convertAllShopifyInvoices(db, deps, 2)).toMatchObject({ completed: ['SHOPIFY-1', 'SHOPIFY-2'], remaining: 1 });
    expect(await convertAllShopifyInvoices(db, deps, 2)).toMatchObject({ completed: ['SHOPIFY-3'], remaining: 0 });
  });
});

describe('order ids from an invoice', () => {
  it('Shopify\'s number from the field, the invoice id, or the name', () => {
    expect(orderIdForInvoice({ id: 'X', shopifyOrderNumber: 1440 })).toBe('SHOPIFY-1440');
    expect(orderIdForInvoice({ id: 'SHOPIFY-1001' })).toBe('SHOPIFY-1001');
    expect(orderIdForInvoice({ id: 'INV-000050', shopifyOrderName: '#1002' })).toBe('SHOPIFY-1002');
    expect(orderIdForInvoice({ id: 'INV-000051' })).toBe('SHOPIFY-INV-INV-000051');
  });

  it('moves an order the first pass named SHOPIFY-INV-SHOPIFY-<n> to SHOPIFY-<n>', async () => {
    const { db, data } = fakeDb(seed(invoice('SHOPIFY-1001', { shopifyOrderNumber: undefined, shopifyOrderId: undefined, shopifyOrderName: undefined, sourceOrderId: 'SHOPIFY-INV-SHOPIFY-1001' })));
    data.orders = { 'SHOPIFY-INV-SHOPIFY-1001': { status: 'Completed', invoiceId: 'SHOPIFY-1001', linkedFromInvoiceId: 'SHOPIFY-1001' } };
    const r = await convertAllShopifyInvoices(db, deps);
    expect(r.renamed).toEqual(['SHOPIFY-1001']);
    expect(Object.keys(data.orders)).toEqual(['SHOPIFY-1001']);
    expect(data.orders['SHOPIFY-1001']).toMatchObject({ status: 'Completed', invoiceId: 'SHOPIFY-1001' });
    expect(data.invoices['SHOPIFY-1001']).toMatchObject({ sourceOrderId: 'SHOPIFY-1001' });
  });
});

describe('the delivery earlier converted orders carried unnamed', () => {
  it('names the gap between the stored subtotal and the pieces, once; leaves invoiced, named and level orders', async () => {
    const { nameHiddenDelivery } = await import('./shopify-invoice-to-order');
    const { db, data } = fakeDb(seed());
    const pieces = [{ isManualPrice: true, manualPrice: 4000 }, { isManualPrice: true, manualPrice: 4000 }];
    data.orders = {
      'SHOPIFY-1460': { source: 'shopify', subtotal: 8350, items: pieces },
      'SHOPIFY-1461': { source: 'shopify', subtotal: 8000, items: pieces },
      'SHOPIFY-1462': { source: 'shopify', subtotal: 8350, items: pieces, deliveryCharge: 0 },
      'SHOPIFY-1463': { source: 'shopify', subtotal: 8350, items: pieces, invoiceId: 'INV-1' },
      'ORD-000001': { source: 'walk-in', subtotal: 8350, items: pieces },
      'SHOPIFY-1001': { source: 'shopify', subtotal: 8350, items: pieces, invoiceId: 'SHOPIFY-1001', linkedFromInvoiceId: 'SHOPIFY-1001' },
    };
    data.invoices = { 'SHOPIFY-1001': { adjustmentsAmount: 350 } };
    expect(await nameHiddenDelivery(db)).toEqual(['SHOPIFY-1460', 'SHOPIFY-1001']);
    expect(data.orders['SHOPIFY-1001']).toMatchObject({ deliveryCharge: 350 });
    expect(data.orders['SHOPIFY-1460']).toMatchObject({ deliveryCharge: 350, subtotal: 8350 });
    expect(await nameHiddenDelivery(db)).toEqual([]);
  });
});
