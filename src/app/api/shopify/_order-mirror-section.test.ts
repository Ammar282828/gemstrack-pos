import { beforeEach, describe, expect, it, vi } from 'vitest';

type Doc = Record<string, unknown>;
const store = vi.hoisted(() => ({ data: { orders: new Map<string, Doc>(), invoices: new Map<string, Doc>(), app_settings: new Map<string, Doc>() } as Record<string, Map<string, Doc>>, shopify: {} as Record<string, unknown>, transactions: [] as unknown[] }));

vi.mock('@/lib/store-config', async (orig) => ({ ...(await orig<typeof import('@/lib/store-config')>()), STORE_SHOPIFY_SECTION: true }));
vi.mock('@/lib/firebase-admin', () => {
  const col = (name: string) => {
    const query = (filters: [string, unknown][] = []) => ({
      where: (f: string, _o: string, v: unknown) => query([...filters, [f, v]]),
      limit: () => query(filters),
      get: async () => {
        const docs = [...store.data[name]].filter(([, d]) => filters.every(([f, v]) => d[f] === v)).map(([id, d]) => ({ id, data: () => d }));
        return { empty: docs.length === 0, docs };
      },
    });
    return { ...query(), add: async () => ({ id: 'log' }), doc: (id: string) => ({ get: async () => ({ exists: store.data[name].has(id), data: () => store.data[name].get(id) }) }) };
  };
  return { adminDb: { collection: col } };
});
vi.mock('@/lib/db-admin-port', () => {
  const adminPort = {
    get: async (c: string, id: string) => (store.data[c].has(id) ? { ...store.data[c].get(id), id } : null),
    queryEquals: async (c: string, f: string, v: unknown) => [...store.data[c]].filter(([, d]) => d[f] === v).map(([id, d]) => ({ ...d, id })),
    runTransaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const writes: (() => void)[] = [];
      const out = await fn({
        get: async (c: string, id: string) => (store.data[c].has(id) ? { ...structuredClone(store.data[c].get(id)!), id } : null),
        set: (c: string, id: string, d: Doc) => writes.push(() => { store.data[c].set(id, { ...d }); }),
        update: (c: string, id: string, d: Doc) => writes.push(() => { store.data[c].set(id, { ...store.data[c].get(id), ...d }); }),
      });
      writes.forEach(w => w());
      return out;
    },
  };
  return { adminPort };
});
vi.mock('./_lib', async (orig) => ({
  ...(await orig<typeof import('./_lib')>()),
  shopifyRequest: async (_s: string, _t: string, _m: string, path: string) =>
    path.endsWith('/transactions.json') ? { transactions: store.transactions } : { order: store.shopify },
}));

import { mirrorShopifyOrderById } from './_order-mirror';

const order = (o: Doc = {}) => ({
  id: 7445131428120, order_number: 1440, financial_status: 'pending', fulfillment_status: null, source_name: 'web',
  total_price: '5000.00', total_discounts: '0.00', created_at: '2026-11-09T10:00:00Z', tags: '', note: null,
  line_items: [{ id: 1, name: 'Ring', price: '5000.00', quantity: 1 }], customer: null, email: 'a@b.c', ...o,
});

beforeEach(() => {
  for (const m of Object.values(store.data)) m.clear();
  store.data.app_settings.set('global', { lastOrderNumber: 7, goldRatePerGram24k: 1, goldRatePerGram22k: 1, goldRatePerGram21k: 1, goldRatePerGram18k: 1, silverRatePerGram: 1 });
  store.shopify = order(); store.transactions = [];
});

describe('a house with the Shopify section takes a new web order as an ORDER', () => {
  it('imports it once, even when two notices arrive together, and no invoice is made', async () => {
    const [a, b] = await Promise.all([
      mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true }),
      mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true }),
    ]);
    expect([a, b].every(o => 'asOrder' in o && o.asOrder)).toBe(true);
    expect([...store.data.orders.keys()]).toEqual(['SHOPIFY-1440']);
    expect(store.data.invoices.size).toBe(0);
    expect(store.data.app_settings.get('global')?.lastOrderNumber).toBe(7);
  });

  it('a paid notice (and its replay) records one advance', async () => {
    store.shopify = order({ financial_status: 'paid' });
    store.transactions = [{ id: 21, kind: 'sale', status: 'success', amount: '5000.00', gateway: 'bank transfer', processed_at: '2026-11-09T10:05:00Z' }];
    await mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true });
    await mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true });
    expect(store.data.orders.get('SHOPIFY-1440')).toMatchObject({ advancePayment: 5000, grandTotal: 0 });
    expect((store.data.orders.get('SHOPIFY-1440')!.advances as unknown[]).length).toBe(1);
  });

  it('a cancel notice cancels an unpaid order', async () => {
    await mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true });
    store.shopify = order({ cancelled_at: '2026-11-09T12:00:00Z' });
    await mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true });
    expect(store.data.orders.get('SHOPIFY-1440')).toMatchObject({ status: 'Cancelled' });
  });

  it('an order the ERP already holds as an invoice (history) is mirrored there, not made again as an order', async () => {
    store.data.invoices.set('SHOPIFY-1440', { id: 'SHOPIFY-1440', source: 'shopify', shopifyOrderId: '7445131428120', grandTotal: 5000, paymentHistory: [] });
    await mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true }).catch(() => undefined);
    expect(store.data.orders.size).toBe(0);
  });
});
