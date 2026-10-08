import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { createInvoice, type SaleLine } from './create-invoice';

/** An in-memory database with Firestore's merge and a commit counter (all made-up data). */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  let ids = 0;
  const stats = { transactions: 0 };
  const col = (c: string) => (data[c] ??= {});
  const db: DbPort = {
    async runTransaction(fn) {
      stats.transactions++;
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    },
    async queryEquals(c, field, value) {
      return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never);
    },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { col(c)[id] = { ...col(c)[id], ...d }; },
    batch() { return { set() {}, update() {}, delete() {}, async commit() {} }; },
    newId() { return `h${++ids}`; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data, stats };
}

const rates = { goldRatePerGram21k: 30_000, goldRatePerGram22k: 32_000, goldRatePerGram24k: 35_000, goldRatePerGram18k: 26_000 };
const ring = (sku: string, over: Partial<SaleLine> = {}): SaleLine => ({
  sku, name: `Demo ring ${sku}`, categoryId: 'Ring', metalType: 'gold', karat: '21k', metalWeightG: 4, stoneWeightG: 0,
  wastagePercentage: 10, makingCharges: 5_000, hasDiamonds: false, hasStones: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0,
  ...over,
} as SaleLine);
// 4 g × 30,000 = 120,000; wastage 10% = 12,000; making 5,000 → 137,000
const RING = 137_000;

const NOW = '2026-10-08T10:00:00.000Z';
const fx = (extra: Record<string, unknown> = {}) => ({ now: () => NOW, newCustomerId: () => 'cust-new', ...extra });

describe('a new sale', () => {
  it('takes the next number, moves the piece to sold, and books what is owed, in one commit', async () => {
    const { db, data, stats } = fakeDb({
      app_settings: { global: { lastInvoiceNumber: 41 } },
      products: { 'RNG-1': ring('RNG-1') as never },
      customers: { 'cust-1': { name: 'Demo Customer', phone: '+923000000001' } },
    });
    const alerts: string[] = [];
    const inv = await createInvoice(db, {
      cart: [ring('RNG-1')], customer: { id: 'cust-1', name: 'typed name', phone: '03000000001' }, rates, discountAmount: 2_000,
      payments: [{ amount: 50_000, method: 'Cash' }], takenBy: 'Demo', lastInvoiceNumber: 41,
    }, fx({ notify: (id: string) => alerts.push(id) }));
    expect(stats.transactions).toBe(1);
    expect(inv.id).toBe('INV-000042');
    expect(inv.customerName).toBe('Demo Customer'); // the book's name, not the typed one
    expect(inv.grandTotal).toBe(RING - 2_000);
    expect(inv.amountPaid).toBe(50_000);
    expect(inv.balanceDue).toBe(RING - 2_000 - 50_000);
    expect(inv.paymentHistory).toEqual([{ amount: 50_000, date: NOW, notes: 'Payment received (Cash)', method: 'Cash' }]);
    expect(data.app_settings.global.lastInvoiceNumber).toBe(42);
    expect(data.products['RNG-1']).toBeUndefined();
    expect(data.sold_products['RNG-1']).toMatchObject({ sku: 'RNG-1' });
    const rows = Object.values(data.hisaab);
    expect(rows).toEqual([expect.objectContaining({ entityId: 'cust-1', cashDebit: RING - 52_000, linkedInvoiceId: 'INV-000042' })]);
    expect(alerts).toEqual(['INV-000042']);
    expect(typeof inv.shareToken).toBe('string');
  });

  it('refuses a stale counter rather than writing over an invoice', async () => {
    const { db, data } = fakeDb({ app_settings: { global: { lastInvoiceNumber: 5 } }, invoices: { 'INV-000006': { grandTotal: 1 } } });
    await expect(createInvoice(db, { cart: [ring('R')], customer: { name: 'Walk-in Customer' }, rates, discountAmount: 0, lastInvoiceNumber: 5 }, fx()))
      .rejects.toThrow(/already exists/);
    expect(data.app_settings.global.lastInvoiceNumber).toBe(5);
  });

  it('a walk-in makes no customer; a typed name does', async () => {
    const walkIn = fakeDb({ app_settings: { global: { lastInvoiceNumber: 0 } } });
    const a = await createInvoice(walkIn.db, { cart: [ring('R')], customer: { name: 'Walk-in Customer' }, rates, discountAmount: 0 }, fx());
    expect(a.customerId).toBeUndefined();
    expect(walkIn.data.customers).toBeUndefined();
    // Owed by a walk-in is booked under the fixed walk-in entity.
    expect(Object.values(walkIn.data.hisaab)[0]).toMatchObject({ entityId: 'walk-in', entityName: 'Walk-in Customer' });

    const named = fakeDb({ app_settings: { global: { lastInvoiceNumber: 0 } } });
    const b = await createInvoice(named.db, { cart: [ring('R')], customer: { name: 'New Person', phone: '0300 0000002' }, rates, discountAmount: 0 }, fx());
    expect(b.customerId).toBe('cust-new');
    expect(named.data.customers['cust-new']).toEqual({ name: 'New Person', phone: '0300 0000002', address: '', email: '' });
  });

  it('a walk-in cannot pay past the total; a named customer keeps the rest as credit', async () => {
    const w = fakeDb({ app_settings: { global: { lastInvoiceNumber: 0 } } });
    await expect(createInvoice(w.db, { cart: [ring('R')], customer: { name: 'Walk-in Customer' }, rates, discountAmount: 0, payments: [{ amount: RING + 10_000 }] }, fx()))
      .rejects.toThrow(/Name the customer/);

    const n = fakeDb({ app_settings: { global: { lastInvoiceNumber: 0 } }, customers: { c9: { name: 'Demo Credit' } } });
    const inv = await createInvoice(n.db, { cart: [ring('R')], customer: { id: 'c9', name: 'Demo Credit' }, rates, discountAmount: 0, payments: [{ amount: RING + 10_000 }] }, fx());
    expect(inv.balanceDue).toBe(-10_000);
    expect(Object.values(n.data.hisaab)).toEqual([expect.objectContaining({ entityId: 'c9', cashCredit: 10_000, cashDebit: 0, description: 'Credit held for Invoice INV-000001' })]);
  });

  it('a discount is never more than the pieces, and the exchange comes off the total', async () => {
    const { db } = fakeDb({ app_settings: { global: { lastInvoiceNumber: 0 } } });
    const inv = await createInvoice(db, {
      cart: [ring('R')], customer: { name: 'Walk-in Customer' }, rates, discountAmount: 999_999,
      exchanges: [{ description: 'Old ring', value: 20_000 }],
    }, fx());
    expect(inv.discountAmount).toBe(RING);
    expect(inv.grandTotal).toBe(-20_000);
  });
});

describe('an invoice edited and saved again', () => {
  const seed = () => fakeDb({
    app_settings: { global: { lastInvoiceNumber: 10 } },
    customers: { c1: { name: 'Demo Edit' } },
    invoices: {
      'INV-000007': {
        grandTotal: 200_000, createdAt: '2026-09-01T09:00:00.000Z', customerId: 'c1', customerName: 'Demo Edit',
        paymentHistory: [{ amount: 100_000, date: '2026-09-01T09:00:00.000Z' }], amountPaid: 100_000,
        sourceOrderId: 'ORD-000003', shareToken: 'kept-share-token-abcdefghij', adjustmentsAmount: 500,
        items: [{ sku: 'R', karigarId: 'k1', isCompleted: true, itemCategory: 'Rings' }],
      },
    },
    hisaab: { old1: { linkedInvoiceId: 'INV-000007', cashDebit: 100_000 }, other: { linkedInvoiceId: 'INV-000008', cashDebit: 5 } },
  });

  it('keeps its number, its day, its payments, where it came from and the workshop marks; swaps its ledger rows', async () => {
    const { db, data } = seed();
    const logs: string[] = [];
    const alerts: string[] = [];
    const inv = await createInvoice(db, { cart: [ring('R')], customer: { id: 'c1', name: 'Demo Edit' }, rates, discountAmount: 0, existingInvoiceId: 'INV-000007' },
      fx({ log: (_a: string, title: string, detail: string) => logs.push(`${title} | ${detail}`), notify: (id: string) => alerts.push(id) }));
    expect(inv.id).toBe('INV-000007');
    expect(data.app_settings.global.lastInvoiceNumber).toBe(10);
    expect(inv.createdAt).toBe('2026-09-01T09:00:00.000Z');
    expect(inv.amountPaid).toBe(100_000);
    expect(inv.sourceOrderId).toBe('ORD-000003');
    expect(inv.shareToken).toBe('kept-share-token-abcdefghij');
    expect(inv.adjustmentsAmount).toBe(500);
    expect(inv.items[0]).toMatchObject({ karigarId: 'k1', isCompleted: true, itemCategory: 'Rings' });
    expect(data.hisaab.old1).toBeUndefined();
    expect(data.hisaab.other).toBeDefined();
    expect(Object.values(data.hisaab).filter((r) => r.linkedInvoiceId === 'INV-000007')).toEqual([expect.objectContaining({ cashDebit: RING - 100_000 })]);
    // An edit is an update, not a second sale, and raises no new-sale alert.
    expect(logs[0]).toMatch(/^Updated invoice INV-000007 \| Customer: Demo Edit \| Total: 200,000 → 137,000/);
    expect(alerts).toEqual([]);
  });

  it('fails as a whole: an empty sale writes nothing', async () => {
    const { db, data } = seed();
    await expect(createInvoice(db, { cart: [], customer: { name: 'x' }, rates, discountAmount: 0 }, fx())).rejects.toThrow(/no pieces/);
    expect(data.hisaab.old1).toBeDefined();
  });
});
