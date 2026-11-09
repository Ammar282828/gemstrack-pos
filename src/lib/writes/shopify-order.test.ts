import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { importShopifyAsOrder, mirrorShopifyToOrder, shopifyPieces, type ShopifyWebOrder } from './shopify-order';
import { invoiceFromOrder } from './finalize-order';
import type { FinalizedItem } from '@/lib/order-finalize';
import type { Order, Settings } from '@/lib/store';

/** An in-memory database for the order writes (as order-writes.test.ts's). */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
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
    async queryEquals() { return []; },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { col(c)[id] = { ...col(c)[id], ...d }; },
    batch() { throw new Error('unused'); },
    newId() { return 'n'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

const seed = () => ({ app_settings: { global: { lastOrderNumber: 41, goldRatePerGram24k: 1, goldRatePerGram22k: 1, goldRatePerGram21k: 1, goldRatePerGram18k: 1, silverRatePerGram: 1 } } });
const deps = { createCustomer: async () => null, clean: <T extends object>(o: T) => JSON.parse(JSON.stringify(o)) as T, metal: 'silver' as const };

const order = (o: Partial<ShopifyWebOrder> = {}): ShopifyWebOrder => ({
  id: 7445131428120, order_number: 1440, financial_status: 'pending', fulfillment_status: null, cancelled_at: null,
  total_price: '5500.00', total_discounts: '500.00', created_at: '2026-11-09T10:00:00Z', email: 'a@b.c',
  line_items: [{ id: 1, name: 'Ring', price: '3000.00', quantity: 2, properties: [{ name: 'Cut', value: 'Oval' }, { name: '_x', value: 'hidden' }] }, { id: 2, name: 'Chain', price: '0.00', quantity: 1 }],
  customer: { id: 99, first_name: 'Sara', last_name: 'Ali', phone: '+923001234567' },
  ...o,
});
const tx = (id: number, amount: string, gateway = 'bank transfer', at = '2026-11-09T11:00:00Z') => ({ id, kind: 'sale', status: 'success', amount, gateway, processed_at: at });

describe('a Shopify web order becomes an ERP order', () => {
  it('is made once as SHOPIFY-<number>, Pending, with a piece per unit and the counter left alone', async () => {
    const { db, data } = fakeDb(seed());
    const a = await importShopifyAsOrder(db, order(), deps);
    const b = await importShopifyAsOrder(db, order(), deps);
    expect([a.created, b.created]).toEqual([true, false]);
    expect(Object.keys(data.orders)).toEqual(['SHOPIFY-1440']);
    expect(data.app_settings.global.lastOrderNumber).toBe(41);
    const o = data.orders['SHOPIFY-1440'] as Record<string, unknown> & { items: { description: string; metalType: string; manualPrice: number }[] };
    expect(o).toMatchObject({
      status: 'Pending', source: 'shopify', shopifyOrderId: '7445131428120', shopifyOrderNumber: 1440,
      customerId: 'shopify-99', customerName: 'Sara Ali', subtotal: 6000, discountAmount: 500, grandTotal: 5500, advancePayment: 0,
      createdAt: '2026-11-09T10:00:00Z', shopifyTransactionIds: [],
    });
    expect(o.items).toHaveLength(3);
    expect(o.items[0]).toMatchObject({ description: 'Ring · Cut: Oval', metalType: 'silver', manualPrice: 3000 });
  });

  it('gold houses get a karat; silver none', () => {
    expect(shopifyPieces(order(), 'gold')[0]).toMatchObject({ metalType: 'gold', karat: '21k' });
    expect(shopifyPieces(order(), 'silver')[0]).not.toHaveProperty('karat');
  });
});

describe('Shopify money and state onto the order', () => {
  const seeded = async (o = order()) => { const f = fakeDb(seed()); await importShopifyAsOrder(f.db, o, deps); return f; };

  it('a paid order gets its payment as one advance, and a replay adds nothing', async () => {
    const { db, data } = await seeded();
    const paid = order({ financial_status: 'paid' });
    const r1 = await mirrorShopifyToOrder(db, 'SHOPIFY-1440', paid, [tx(11, '5500.00')]);
    expect(r1?.added).toHaveLength(1);
    const o = () => data.orders['SHOPIFY-1440'] as { advances: { id: string; amount: number; method?: string }[]; advancePayment: number; grandTotal: number; shopifyTransactionIds: string[] };
    expect(o().advances).toEqual([expect.objectContaining({ id: 'adv-shopify-11', amount: 5500, method: 'Bank Transfer' })]);
    expect(o()).toMatchObject({ advancePayment: 5500, grandTotal: 0, shopifyTransactionIds: ['11'] });
    const r2 = await mirrorShopifyToOrder(db, 'SHOPIFY-1440', paid, [tx(11, '5500.00')]);
    expect(r2).toMatchObject({ changed: false, added: [] });
    expect(o().advances).toHaveLength(1);
    expect(o().advancePayment).toBe(5500);
  });

  it('a part payment is an advance and the rest stays owed; the second payment follows', async () => {
    const { db, data } = await seeded();
    const part = order({ financial_status: 'partially_paid' });
    await mirrorShopifyToOrder(db, 'SHOPIFY-1440', part, [tx(1, '2000.00')]);
    const o = () => data.orders['SHOPIFY-1440'] as { advancePayment: number; grandTotal: number; advances: unknown[] };
    expect(o()).toMatchObject({ advancePayment: 2000, grandTotal: 3500 });
    await mirrorShopifyToOrder(db, 'SHOPIFY-1440', part, [tx(1, '2000.00'), tx(2, '3500.00', 'bank transfer', '2026-11-10T09:00:00Z')]);
    expect(o()).toMatchObject({ advancePayment: 5500, grandTotal: 0 });
    expect(o().advances).toHaveLength(2);
  });

  it('never takes more than is owed, and not what the counter already took', async () => {
    const { db, data } = await seeded();
    (data.orders['SHOPIFY-1440'] as Record<string, unknown>).advancePayment = 5000;
    (data.orders['SHOPIFY-1440'] as Record<string, unknown>).advances = [{ id: 'adv-by-hand', amount: 5000, date: '2026-11-09T09:00:00Z' }];
    await mirrorShopifyToOrder(db, 'SHOPIFY-1440', order({ financial_status: 'paid' }), [tx(5, '5500.00')]);
    expect((data.orders['SHOPIFY-1440'] as { advancePayment: number }).advancePayment).toBe(5500);
  });

  it('cash on delivery has no advance, only Shopify\'s state', async () => {
    const { db, data } = await seeded();
    const r = await mirrorShopifyToOrder(db, 'SHOPIFY-1440', order({ fulfillment_status: 'fulfilled' }), []);
    expect(r?.added).toEqual([]);
    expect(data.orders['SHOPIFY-1440']).toMatchObject({ advancePayment: 0, grandTotal: 5500, shopifyFulfillment: 'fulfilled', status: 'Pending' });
  });

  it('cancelled on Shopify with nothing paid is Cancelled; with money it is only marked', async () => {
    const a = await seeded();
    const cancelled = order({ cancelled_at: '2026-11-09T12:00:00Z' });
    expect((await mirrorShopifyToOrder(a.db, 'SHOPIFY-1440', cancelled, []))?.cancelled).toBe(true);
    expect(a.data.orders['SHOPIFY-1440']).toMatchObject({ status: 'Cancelled', shopifyCancelledAt: '2026-11-09T12:00:00Z' });
    const b = await seeded();
    await mirrorShopifyToOrder(b.db, 'SHOPIFY-1440', order({ financial_status: 'paid', cancelled_at: '2026-11-09T12:00:00Z' }), [tx(3, '5500.00')]);
    expect(b.data.orders['SHOPIFY-1440']).toMatchObject({ status: 'Pending', shopifyCancelledAt: '2026-11-09T12:00:00Z', advancePayment: 5500 });
  });

  it('keeps what the shop changed: pieces, status and discount are untouched', async () => {
    const { db, data } = await seeded();
    Object.assign(data.orders['SHOPIFY-1440'], { status: 'In Progress', discountAmount: 800, items: [{ description: 'Edited', karigarId: 'k1' }] });
    await mirrorShopifyToOrder(db, 'SHOPIFY-1440', order({ financial_status: 'paid' }), [tx(4, '1000.00')]);
    expect(data.orders['SHOPIFY-1440']).toMatchObject({ status: 'In Progress', discountAmount: 800, items: [{ description: 'Edited', karigarId: 'k1' }], advancePayment: 1000, grandTotal: 4200 });
  });

  it('an invoiced order takes no money (the invoice does) but shows Shopify\'s state', async () => {
    const { db, data } = await seeded();
    (data.orders['SHOPIFY-1440'] as Record<string, unknown>).invoiceId = 'INV-000001';
    await mirrorShopifyToOrder(db, 'SHOPIFY-1440', order({ financial_status: 'paid' }), [tx(6, '5500.00')]);
    expect(data.orders['SHOPIFY-1440']).toMatchObject({ advancePayment: 0, shopifyFinancialStatus: 'paid' });
  });

  it('is nothing when there is no such order', async () => {
    expect(await mirrorShopifyToOrder(fakeDb(seed()).db, 'SHOPIFY-9', order(), [])).toBeNull();
  });
});

describe('finalizing keeps it a Shopify sale', () => {
  it('the invoice keeps source shopify, the ids and the transactions, and the advance as its payment', async () => {
    const { db, data } = fakeDb(seed());
    await importShopifyAsOrder(db, order(), deps);
    await mirrorShopifyToOrder(db, 'SHOPIFY-1440', order({ financial_status: 'partially_paid' }), [tx(8, '2000.00')]);
    const o = { ...data.orders['SHOPIFY-1440'], id: 'SHOPIFY-1440' } as unknown as Order;
    const inv = invoiceFromOrder(o, [3000, 3000, 0].map(p => ({ isManualPrice: true, finalManualPrice: p }) as FinalizedItem), 500, undefined, {} as Settings, '2026-11-12T00:00:00.000Z', x => x);
    expect(inv).toMatchObject({ source: 'shopify', sourceOrderId: 'SHOPIFY-1440', shopifyOrderId: '7445131428120', shopifyTransactionIds: ['8'], amountPaid: 2000, balanceDue: 3500 });
    expect(inv).not.toHaveProperty('acquisitionSource');
  });
});
