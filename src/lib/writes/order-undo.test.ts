import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { deleteOrder, OrderUndoRefusal, refundOrder, revertedStatus, undoOrderInvoice, type OrderShopifyCall } from './order-undo';

// Made-up shop: every name, sku and amount here is invented.
const REMOVE = '<field removed>';

/** An in-memory database that counts commits, so "one trip" is checked, not assumed. */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>, opts: { failGet?: string } = {}) {
  const data = structuredClone(seed);
  const stats = { batches: 0, commits: 0, transactions: 0 };
  const col = (c: string) => (data[c] ??= {});
  const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
    const next: Record<string, unknown> = merge ? { ...col(c)[id], ...d } : { ...d };
    for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
    col(c)[id] = next;
  };
  const db: DbPort = {
    async runTransaction(fn) {
      stats.transactions++;
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
    async get(c, id) {
      if (opts.failGet === `${c}/${id}`) throw new Error('unavailable');
      const d = col(c)[id];
      return d ? ({ ...structuredClone(d), id } as never) : null;
    },
    async add() { throw new Error('not used'); },
    async update(c, id, d) { put(c, id, d, true); },
    batch() {
      stats.batches++;
      const writes: (() => void)[] = [];
      return {
        set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => put(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
        async commit() { stats.commits++; writes.forEach(w => w()); },
      };
    },
    newId: (c) => `${c}-new`,
    timestamp: (d) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  const deps = {
    deleteField: () => REMOVE,
    invoices: async () => Object.entries(col('invoices')).map(([id, d]) => ({ id, items: d.items })),
  };
  return { db, data, stats, deps };
}

function effects() {
  const logged: string[][] = [];
  const shopify: OrderShopifyCall[] = [];
  return { logged, shopify, fx: { log: (a: string, t: string, d: string, r?: string) => { logged.push([a, t, d, r ?? '']); }, shopify: (c: OrderShopifyCall) => { shopify.push(c); } } };
}

const ring = { sku: 'RNG-101', name: 'Test ring', categoryId: 'rings', metalType: 'gold', karat: '21k', metalWeightG: 4.2, stoneWeightG: 0, wastagePercentage: 10, makingCharges: 5_000, diamondChargesIfAny: 0, stoneChargesIfAny: 1_500, miscChargesIfAny: 0, unitPrice: 90_000 };
const pendant = { sku: 'PND-202', name: 'Test pendant', categoryId: 'pendants', metalType: 'gold', karat: '18k', metalWeightG: 2, stoneWeightG: 0.1, wastagePercentage: 12, makingCharges: 3_000, diamondChargesIfAny: 20_000, stoneChargesIfAny: 0, miscChargesIfAny: 0, isCustomPrice: true, unitPrice: 75_000 };
const madeForOrder = { sku: 'ORD-000007-1', name: 'Bangle made to order', metalType: 'gold', karat: '22k', metalWeightG: 12 };

describe('Undo invoice', () => {
  it('takes the invoice and its hisaab rows off, keeps the pieces sold, and opens the order again — in one commit', async () => {
    const { db, data, stats, deps } = fakeDb({
      orders: { 'ORD-000007': { status: 'Completed', invoiceId: 'INV-000050', customerName: 'Test Customer', grandTotal: 0 } },
      invoices: { 'INV-000050': { items: [madeForOrder], customerName: 'Test Customer', sourceOrderId: 'ORD-000007', shopifyOrderId: '9001', shopifyOrderNumber: 1201 } },
      hisaab: { h1: { linkedInvoiceId: 'INV-000050', cashDebit: 40_000 }, h2: { linkedInvoiceId: 'INV-000099', cashDebit: 5 } },
      sold_products: {},
    });
    const { fx, logged, shopify } = effects();
    const out = await undoOrderInvoice(db, { orderId: 'ORD-000007', invoiceId: 'INV-000050' }, deps, fx);
    expect(out).toEqual({ orderId: 'ORD-000007', invoiceId: 'INV-000050', status: 'In Progress', removed: true });
    expect(data.invoices['INV-000050']).toBeUndefined();
    expect(data.hisaab.h1).toBeUndefined();
    expect(data.hisaab.h2).toEqual({ linkedInvoiceId: 'INV-000099', cashDebit: 5 }); // another invoice's row stays
    // The invoice's Shopify order is carried forward, the link to the invoice gone.
    expect(data.orders['ORD-000007']).toEqual({ status: 'In Progress', customerName: 'Test Customer', grandTotal: 0, shopifyOrderId: '9001', shopifyOrderNumber: 1201 });
    expect(data.products).toBeUndefined(); // nothing back in stock on an undo
    expect(stats).toEqual({ batches: 1, commits: 1, transactions: 0 });
    expect(logged).toEqual([
      ['invoice.delete', 'Deleted invoice INV-000050', 'Customer: Test Customer', 'INV-000050'],
      ['order.revert', 'Reverted order ORD-000007', 'Cancelled invoice INV-000050', 'ORD-000007'],
    ]);
    expect(shopify).toEqual([]); // the link is carried forward, nothing cancelled
  });

  it('keeps a status other than Completed', async () => {
    expect(revertedStatus('Completed')).toBe('In Progress');
    expect(revertedStatus('Pending')).toBe('Pending');
    expect(revertedStatus('In Progress')).toBe('In Progress');
    expect(revertedStatus(undefined)).toBe('In Progress');
  });

  it('opens the order even when its invoice has already gone', async () => {
    const { db, data, deps } = fakeDb({ orders: { 'ORD-000008': { status: 'Completed', invoiceId: 'INV-000051' } } });
    const { fx, logged } = effects();
    const out = await undoOrderInvoice(db, { orderId: 'ORD-000008', invoiceId: 'INV-000051' }, deps, fx);
    expect(out.removed).toBe(false);
    expect(data.orders['ORD-000008']).toEqual({ status: 'In Progress' });
    expect(logged.map(l => l[0])).toEqual(['order.revert']);
  });

  it('refuses an order not on file, or invoiced again since the screen showed it', async () => {
    const { db, deps } = fakeDb({ orders: { 'ORD-000009': { status: 'Completed', invoiceId: 'INV-000060' } }, invoices: { 'INV-000052': { sourceOrderId: 'ORD-000009' } } });
    await expect(undoOrderInvoice(db, { orderId: 'ORD-404', invoiceId: 'INV-000052' }, deps)).rejects.toThrow(OrderUndoRefusal);
    await expect(undoOrderInvoice(db, { orderId: 'ORD-000009', invoiceId: 'INV-000052' }, deps)).rejects.toThrow(/has changed since/);
  });
});

describe('Refund order', () => {
  it('deletes the invoice, puts its stock back as it was priced, marks the order Refunded and refunds it on Shopify after', async () => {
    const { db, data, stats, deps } = fakeDb({
      orders: { 'ORD-000010': { status: 'Completed', invoiceId: 'INV-000070', customerName: 'Test Customer', shopifyDraftOrderId: 'D-55' } },
      invoices: {
        'INV-000070': { items: [ring, pendant, madeForOrder], customerName: 'Test Customer', sourceOrderId: 'ORD-000010', shopifyOrderId: '9002' },
      },
      sold_products: { 'RNG-101': { sku: 'RNG-101' }, 'PND-202': { sku: 'PND-202' } },
      hisaab: { h1: { linkedInvoiceId: 'INV-000070', cashDebit: 10_000 } },
    });
    const { fx, logged, shopify } = effects();
    const out = await refundOrder(db, { orderId: 'ORD-000010' }, deps, fx);
    expect(out).toEqual({ orderId: 'ORD-000010', invoiceId: 'INV-000070', restocked: ['RNG-101', 'PND-202'] });
    expect(data.invoices['INV-000070']).toBeUndefined();
    expect(data.hisaab.h1).toBeUndefined();
    expect(data.sold_products).toEqual({});
    expect(data.products['RNG-101']).toEqual({
      sku: 'RNG-101', name: 'Test ring', categoryId: 'rings', metalType: 'gold', karat: '21k', metalWeightG: 4.2, hasStones: true,
      stoneWeightG: 0, wastagePercentage: 10, makingCharges: 5_000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 1_500, miscCharges: 0,
    });
    // A custom price is kept, so the refunded piece is not re-priced at today's rate.
    expect(data.products['PND-202']).toMatchObject({ isCustomPrice: true, customPrice: 75_000, hasDiamonds: true, diamondCharges: 20_000 });
    expect(data.products['ORD-000007-1']).toBeUndefined(); // made for the order: never stock
    expect(data.orders['ORD-000010']).toEqual({ status: 'Refunded', customerName: 'Test Customer', shopifyDraftOrderId: 'D-55' });
    expect(stats.commits).toBe(1);
    expect(logged).toEqual([
      ['invoice.delete', 'Deleted invoice INV-000070', 'Customer: Test Customer', 'INV-000070'],
      ['order.refund', 'Refunded order ORD-000010', 'Customer: Test Customer', 'ORD-000010'],
    ]);
    expect(shopify).toEqual([
      { path: '/api/shopify/sync/invoice', body: { invoiceId: 'INV-000070', shopifyOrderId: '9002', action: 'refund' } },
      { path: '/api/shopify/sync/order', body: { orderId: 'ORD-000010', shopifyDraftOrderId: 'D-55', action: 'cancel' } },
    ]);
  });

  it('leaves a piece another invoice also sold where it is (a sale entered twice)', async () => {
    const { db, data, deps } = fakeDb({
      orders: { 'ORD-000011': { status: 'Completed', invoiceId: 'INV-000071' } },
      invoices: { 'INV-000071': { items: [ring, pendant], sourceOrderId: 'ORD-000011' }, 'INV-000072': { items: [ring] } },
      sold_products: { 'RNG-101': { sku: 'RNG-101' }, 'PND-202': { sku: 'PND-202' } },
    });
    const out = await refundOrder(db, { orderId: 'ORD-000011' }, deps);
    expect(out.restocked).toEqual(['PND-202']);
    expect(data.sold_products).toEqual({ 'RNG-101': { sku: 'RNG-101' } });
    expect(Object.keys(data.products)).toEqual(['PND-202']);
  });

  it('with no invoice: the order is Refunded, its carried-forward Shopify order refunded and its link cleared', async () => {
    const { db, data, deps } = fakeDb({ orders: { 'ORD-000012': { status: 'In Progress', customerName: 'Test Customer', shopifyOrderId: '9003', shopifyOrderNumber: 1300 } } });
    const { fx, logged, shopify } = effects();
    const out = await refundOrder(db, { orderId: 'ORD-000012' }, deps, fx);
    expect(out).toEqual({ orderId: 'ORD-000012', invoiceId: null, restocked: [] });
    expect(data.orders['ORD-000012']).toEqual({ status: 'Refunded', customerName: 'Test Customer' });
    expect(logged.map(l => l[0])).toEqual(['order.refund']);
    expect(shopify).toEqual([{ path: '/api/shopify/sync/invoice', body: { shopifyOrderId: '9003', action: 'refund' } }]);
  });

  it('never refunds a Shopify-made invoice on Shopify, and says "Unknown" for a nameless order', async () => {
    const { db, deps } = fakeDb({
      orders: { 'ORD-000013': { status: 'Completed', invoiceId: 'SHOPIFY-1001' } },
      invoices: { 'SHOPIFY-1001': { items: [], sourceOrderId: 'ORD-000013', shopifyOrderId: '9004' } },
    });
    const { fx, logged, shopify } = effects();
    await refundOrder(db, { orderId: 'ORD-000013' }, deps, fx);
    expect(shopify).toEqual([]);
    expect(logged.at(-1)).toEqual(['order.refund', 'Refunded order ORD-000013', 'Customer: Unknown', 'ORD-000013']);
  });

  it('refuses an order already refunded or cancelled, and one not on file', async () => {
    const { db, deps } = fakeDb({ orders: { 'ORD-R': { status: 'Refunded' }, 'ORD-C': { status: 'Cancelled' } } });
    await expect(refundOrder(db, { orderId: 'ORD-R' }, deps)).rejects.toThrow('ORD-R is already refunded.');
    await expect(refundOrder(db, { orderId: 'ORD-C' }, deps)).rejects.toThrow('ORD-C is cancelled: there is nothing to refund.');
    await expect(refundOrder(db, { orderId: 'ORD-404' }, deps)).rejects.toThrow('No such order: ORD-404.');
  });
});

describe('Delete order', () => {
  it('deletes the order and its sample photos in one commit, then drops its Shopify draft by name', async () => {
    const { db, data, stats } = fakeDb({
      orders: { 'ORD-000020': { status: 'Pending', customerName: 'Test Customer', shopifyDraftOrderId: 'D-77' }, 'ORD-000021': { status: 'Pending' } },
      order_photos: { p1: { orderId: 'ORD-000020', dataUri: 'data:x' }, p2: { orderId: 'ORD-000020', dataUri: 'data:y' }, p3: { orderId: 'ORD-000021', dataUri: 'data:z' } },
    });
    const { fx, logged, shopify } = effects();
    const out = await deleteOrder(db, { orderId: 'ORD-000020' }, fx);
    expect(out).toEqual({ orderId: 'ORD-000020', photos: 2 });
    expect(data.orders).toEqual({ 'ORD-000021': { status: 'Pending' } });
    expect(Object.keys(data.order_photos)).toEqual(['p3']);
    expect(stats.commits).toBe(1);
    expect(logged).toEqual([['order.delete', 'Deleted order: ORD-000020', 'Customer: Test Customer', 'ORD-000020']]);
    expect(shopify).toEqual([{ path: '/api/shopify/sync/order', body: { orderId: 'ORD-000020', shopifyDraftOrderId: 'D-77', action: 'cancel' } }]);
  });

  it('refuses an invoiced order in the page\'s words, and touches nothing', async () => {
    const { db, data } = fakeDb({ orders: { 'ORD-000022': { status: 'Completed', invoiceId: 'INV-000080' } } });
    await expect(deleteOrder(db, { orderId: 'ORD-000022' })).rejects.toThrow('ORD-000022 has invoice INV-000080. Delete or undo the invoice first.');
    expect(data.orders['ORD-000022']).toBeDefined();
  });
});

describe('the order\'s link when an invoice goes', () => {
  it('an undo whose invoice names another order clears that order\'s link too, when it points at this invoice', async () => {
    const { db, data, deps } = fakeDb({
      orders: { 'ORD-A': { status: 'Completed', invoiceId: 'INV-1' }, 'ORD-B': { status: 'Completed', invoiceId: 'INV-1' } },
      invoices: { 'INV-1': { items: [], sourceOrderId: 'ORD-B' } },
    });
    await undoOrderInvoice(db, { orderId: 'ORD-A', invoiceId: 'INV-1' }, deps);
    expect(data.orders['ORD-A']).toEqual({ status: 'In Progress' });
    expect(data.orders['ORD-B']).toEqual({ status: 'Completed' });
  });

  it('an order that could not be read is cleared; one that has gone is left gone', async () => {
    const unread = fakeDb({
      orders: { 'ORD-A': { status: 'Completed', invoiceId: 'INV-2' }, 'ORD-B': { status: 'Completed', invoiceId: 'INV-2' } },
      invoices: { 'INV-2': { items: [], sourceOrderId: 'ORD-B' } },
    }, { failGet: 'orders/ORD-B' });
    await undoOrderInvoice(unread.db, { orderId: 'ORD-A', invoiceId: 'INV-2' }, unread.deps);
    expect(unread.data.orders['ORD-B']).toEqual({ status: 'Completed' });

    const gone = fakeDb({ orders: { 'ORD-A': { status: 'Completed', invoiceId: 'INV-3' } }, invoices: { 'INV-3': { items: [], sourceOrderId: 'ORD-GONE' } } });
    await undoOrderInvoice(gone.db, { orderId: 'ORD-A', invoiceId: 'INV-3' }, gone.deps);
    expect(gone.data.orders['ORD-GONE']).toBeUndefined();
  });
});
