import { beforeEach, describe, expect, it, vi } from 'vitest';

type Doc = Record<string, unknown>;
const store = vi.hoisted(() => ({ invoices: new Map<string, Doc>(), shopify: {} as Record<string, unknown>, mirrored: [] as string[] }));

vi.mock('@/lib/firebase-admin', () => {
  const query = (filters: [string, unknown][] = []) => ({
    kind: 'query' as const,
    where: (f: string, _op: string, v: unknown) => query([...filters, [f, v]]),
    limit: () => query(filters),
    get: async () => {
      const docs = [...store.invoices].filter(([, d]) => filters.every(([f, v]) => d[f] === v)).map(([id, d]) => ({ id, data: () => d }));
      return { empty: docs.length === 0, docs };
    },
  });
  const docRef = (id: string) => ({
    kind: 'doc' as const, id,
    get: async () => ({ exists: store.invoices.has(id), data: () => store.invoices.get(id) }),
    set: async (d: Doc) => { store.invoices.set(id, { ...(store.invoices.get(id) || {}), ...d }); },
  });
  // Firestore transactions are serialised against each other for the same document; model that with a queue.
  let chain: Promise<unknown> = Promise.resolve();
  const adminDb = {
    collection: () => ({ doc: docRef, ...query() }),
    runTransaction: (fn: (t: unknown) => Promise<unknown>) => {
      const run = chain.then(() => fn({
        get: (r: { kind: string; get: () => Promise<unknown> }) => r.get(),
        set: (r: { set: (d: Doc) => Promise<void> }, d: Doc) => { void r.set(d); },
      }));
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return { adminDb };
});
vi.mock('@/lib/db-admin-port', () => ({ adminPort: {} }));
vi.mock('@/lib/writes/invoice-payment', () => ({
  mirrorShopifyOrder: async (_p: unknown, id: string) => { store.mirrored.push(id); return { invoiceId: id, added: [], changed: false }; },
}));
vi.mock('./_lib', async (orig) => ({
  ...(await orig<typeof import('./_lib')>()),
  shopifyRequest: async (_s: string, _t: string, _m: string, path: string) =>
    path.endsWith('/transactions.json') ? { transactions: [] } : { order: store.shopify },
}));

import { importShopifyOrder, mirrorShopifyOrderById } from './_order-mirror';

const order = (o: Doc = {}) => ({
  id: 7445131428120, order_number: 1440, financial_status: 'pending', fulfillment_status: null,
  total_price: '5000.00', total_discounts: '0.00', created_at: '2026-10-15T17:44:00Z', tags: '', note: null,
  line_items: [{ id: 1, name: 'Ring', price: '5000.00', quantity: 1 }], customer: null, email: 'a@b.c', ...o,
});

beforeEach(() => { store.invoices.clear(); store.mirrored.length = 0; store.shopify = order(); });

describe('a new web order arrives on its own', () => {
  it('is imported once, even when two notices arrive together', async () => {
    const [a, b] = await Promise.all([
      mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true }),
      mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true }),
    ]);
    expect([a, b].filter(o => 'imported' in o && o.imported)).toHaveLength(1);
    expect([...store.invoices.keys()]).toEqual(['SHOPIFY-1440']);
    expect(store.invoices.get('SHOPIFY-1440')).toMatchObject({ source: 'shopify', shopifyOrderId: '7445131428120', grandTotal: 5000 });
  });

  it('leaves an invoice the ERP already has untouched', async () => {
    store.invoices.set('SHOPIFY-1440', { id: 'SHOPIFY-1440', grandTotal: 4000, paymentHistory: [{ amount: 1 }] });
    const out = await mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true });
    expect('imported' in out).toBe(false);
    expect(store.invoices.get('SHOPIFY-1440')).toEqual({ id: 'SHOPIFY-1440', grandTotal: 4000, paymentHistory: [{ amount: 1 }] });
    expect(await importShopifyOrder(order())).toBe(false);
  });

  it('finds an earlier import by Shopify order id under another number', async () => {
    store.invoices.set('SHOPIFY-OLD', { shopifyOrderId: '7445131428120', source: 'shopify' });
    expect(await importShopifyOrder(order())).toBe(false);
    expect(store.invoices.has('SHOPIFY-1440')).toBe(false);
  });

  it('skips an order the ERP pushed out itself', async () => {
    store.shopify = order({ tags: 'pos-import, pos-inv-INV-000228', note: 'POS Invoice INV-000228' });
    const out = await mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true });
    expect(out).toMatchObject({ skipped: 'pos-push' });
    expect(store.invoices.size).toBe(0);
  });

  it('is not imported without the notice asking (the mirror script), nor below the cutoff', async () => {
    expect(await mirrorShopifyOrderById('s', 't', '7445131428120')).toMatchObject({ skipped: 'not-imported' });
    store.shopify = order({ order_number: 1300 });
    expect(await mirrorShopifyOrderById('s', 't', '7445131428120', { importIfAbsent: true })).toMatchObject({ skipped: 'not-imported' });
    expect(store.invoices.size).toBe(0);
  });
});
