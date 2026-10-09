import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { cleanInvoiceCustomer, NAME_NEEDED, setInvoiceCustomer } from './invoice-customer';

// An in-memory database behind the port, as people.test.ts has it, with the one query the write makes.
// All names, numbers and amounts made up.
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  const apply = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };
  let transactions = 0;
  const db: DbPort = {
    async runTransaction(fn) {
      transactions++;
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => apply(c, id, d, merge)); },
        update(c, id, d) {
          // Firestore's update refuses a document that is not there.
          if (!col(c)[id]) throw new Error(`no document ${c}/${id}`);
          writes.push(() => apply(c, id, d, true));
        },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    },
    async queryEquals(c, field, value) {
      return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...structuredClone(d), id }) as never);
    },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { apply(c, id, d, true); },
    batch() { throw new Error('not used'); },
    newId() { return 'n1'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data, transactions: () => transactions };
}

const sideEffects = () => {
  const logged: string[][] = [];
  const synced: string[][] = [];
  return {
    logged, synced,
    fx: {
      log: (a: string, t: string, d: string, id?: string) => { logged.push([a, t, d, id ?? '']); },
      syncInvoiceShopify: (id: string, mode: 'upsert' | 'cancel') => { synced.push([id, mode]); },
    },
  };
};

// A walk-in sale still owing, its ledger row under the walk-in entity, and a second invoice's row beside it.
const WALK_IN_SALE = {
  customerName: 'Walk-in Customer', items: [{ sku: 'RNG-001', itemTotal: 50000 }],
  subtotal: 50000, discountAmount: 0, grandTotal: 50000, amountPaid: 20000, balanceDue: 30000,
  createdAt: '2026-10-01T10:00:00.000Z', paymentHistory: [{ amount: 20000, date: '2026-10-01T10:00:00.000Z' }],
};
const seed = () => ({
  invoices: {
    'INV-900001': { ...WALK_IN_SALE },
    'INV-900002': { customerId: 'cust-2', customerName: 'Demo Two', grandTotal: 1000, amountPaid: 0, balanceDue: 1000 },
  },
  customers: {
    'cust-1': { id: 'cust-1', name: 'Demo Customer', phone: '+923001110000' },
    'cust-2': { id: 'cust-2', name: 'Demo Two', phone: '+923002220000' },
  },
  hisaab: {
    h1: { entityId: 'walk-in', entityType: 'customer', entityName: 'Walk-in Customer', linkedInvoiceId: 'INV-900001', cashDebit: 30000, cashCredit: 0 },
    h2: { entityId: 'cust-2', entityType: 'customer', entityName: 'Demo Two', linkedInvoiceId: 'INV-900002', cashDebit: 1000, cashCredit: 0 },
  },
});

describe('setInvoiceCustomer', () => {
  it('a customer picked from the book: the invoice is theirs, under the name on file, and its ledger row moves to them', async () => {
    const { db, data } = fakeDb(seed());
    const { fx, logged, synced } = sideEffects();
    const out = await setInvoiceCustomer(db, 'INV-900001', { customerId: 'cust-1', name: 'demo customer typed', phone: '+923001110000' }, fx);

    expect(data.invoices['INV-900001']).toEqual({ ...WALK_IN_SALE, customerId: 'cust-1', customerName: 'Demo Customer', customerContact: '+923001110000' });
    expect(data.hisaab.h1).toEqual({ ...seed().hisaab.h1, entityId: 'cust-1', entityName: 'Demo Customer', entityType: 'customer' });
    // Nobody else's row, invoice or customer is touched, and no customer is made.
    expect(data.hisaab.h2).toEqual(seed().hisaab.h2);
    expect(data.invoices['INV-900002']).toEqual(seed().invoices['INV-900002']);
    expect(Object.keys(data.customers)).toEqual(['cust-1', 'cust-2']);

    expect(out).toEqual({ ...WALK_IN_SALE, id: 'INV-900001', customerId: 'cust-1', customerName: 'Demo Customer', customerContact: '+923001110000' });
    expect(logged).toEqual([['invoice.update', 'Customer set on invoice INV-900001', 'Walk-in Customer → Demo Customer', 'INV-900001']]);
    expect(synced).toEqual([['INV-900001', 'upsert']]);
  });

  it('nothing is re-priced: the pieces, totals and payments stay as they were', async () => {
    const { db, data } = fakeDb(seed());
    await setInvoiceCustomer(db, 'INV-900001', { customerId: 'cust-1', name: 'Demo Customer' });
    const inv = data.invoices['INV-900001'];
    for (const k of ['items', 'subtotal', 'discountAmount', 'grandTotal', 'amountPaid', 'balanceDue', 'createdAt', 'paymentHistory'] as const) {
      expect(inv[k]).toEqual(WALK_IN_SALE[k]);
    }
    expect(data.hisaab.h1.cashDebit).toBe(30000);
  });

  it('a name typed is a new customer, made as the store makes one, and the number goes on the invoice', async () => {
    const { db, data } = fakeDb(seed());
    const { fx, logged } = sideEffects();
    const out = await setInvoiceCustomer(db, 'INV-900001', { name: '  Demo New  ', phone: ' +923003330000 ' }, fx, { newCustomerId: () => 'cust-new' });

    expect(data.customers['cust-new']).toEqual({ name: 'Demo New', phone: '+923003330000', address: '', email: '' });
    expect(data.invoices['INV-900001']).toMatchObject({ customerId: 'cust-new', customerName: 'Demo New', customerContact: '+923003330000' });
    expect(data.hisaab.h1).toMatchObject({ entityId: 'cust-new', entityName: 'Demo New', entityType: 'customer' });
    expect(out.customerId).toBe('cust-new');
    // The store logs the invoice's change only, never a customer.create of its own.
    expect(logged.map((l) => l[0])).toEqual(['invoice.update']);
  });

  it('makes the id the store makes when none is given', async () => {
    const { db, data } = fakeDb(seed());
    const out = await setInvoiceCustomer(db, 'INV-900001', { name: 'Demo New' });
    expect(out.customerId).toMatch(/^cust-\d+-[a-z0-9]{1,5}$/);
    expect(data.customers[out.customerId!]).toEqual({ name: 'Demo New', phone: '', address: '', email: '' });
  });

  it('with no number given, the invoice keeps the one it has', async () => {
    const { db, data } = fakeDb({ ...seed(), invoices: { 'INV-900001': { ...WALK_IN_SALE, customerContact: '+923004440000' } } });
    await setInvoiceCustomer(db, 'INV-900001', { name: 'Demo New', phone: '  ' }, {}, { newCustomerId: () => 'cust-new' });
    expect(data.invoices['INV-900001'].customerContact).toBe('+923004440000');
    expect(data.customers['cust-new'].phone).toBe('');
  });

  it('a picked customer no longer on file is a new customer of the name typed', async () => {
    const { db, data } = fakeDb(seed());
    await setInvoiceCustomer(db, 'INV-900001', { customerId: 'cust-gone', name: 'Demo Gone' }, {}, { newCustomerId: () => 'cust-new' });
    expect(data.invoices['INV-900001']).toMatchObject({ customerId: 'cust-new', customerName: 'Demo Gone' });
    expect(data.customers['cust-new'].name).toBe('Demo Gone');
    expect(data.customers['cust-gone']).toBeUndefined();
  });

  it('a change of customer: the log says from whom to whom', async () => {
    const { db, data } = fakeDb(seed());
    const { fx, logged } = sideEffects();
    await setInvoiceCustomer(db, 'INV-900002', { customerId: 'cust-1', name: 'Demo Customer' }, fx);
    expect(data.hisaab.h2).toMatchObject({ entityId: 'cust-1', entityName: 'Demo Customer' });
    expect(data.invoices['INV-900002']).toMatchObject({ customerId: 'cust-1', customerName: 'Demo Customer' });
    expect(logged[0][2]).toBe('Demo Two → Demo Customer');
  });

  it('an invoice that had no name at all reads as a walk-in in the log', async () => {
    const { db } = fakeDb({ invoices: { 'INV-900003': { grandTotal: 100 } }, customers: {}, hisaab: {} });
    const { fx, logged } = sideEffects();
    await setInvoiceCustomer(db, 'INV-900003', { name: 'Demo New' }, fx, { newCustomerId: () => 'cust-new' });
    expect(logged[0][2]).toBe('Walk-in → Demo New');
  });

  it('refuses a blank or walk-in name before reading anything', async () => {
    for (const name of ['', '   ', 'Walk-in Customer', 'walk in', 'Walkin']) {
      const { db, data, transactions } = fakeDb(seed());
      await expect(setInvoiceCustomer(db, 'INV-900001', { name })).rejects.toThrow(NAME_NEEDED);
      expect(transactions()).toBe(0);
      expect(data).toEqual(seed());
    }
  });

  it('refuses an invoice that is not on file, and writes nothing', async () => {
    const { db, data } = fakeDb(seed());
    const { fx, logged } = sideEffects();
    await expect(setInvoiceCustomer(db, 'INV-404', { name: 'Demo New' }, fx, { newCustomerId: () => 'cust-new' })).rejects.toThrow('Invoice INV-404 not found.');
    expect(data).toEqual(seed());
    expect(logged).toEqual([]);
  });
});

describe('cleanInvoiceCustomer', () => {
  it('reads the name, the picked customer and the number, kept as the phone box keeps it', () => {
    expect(cleanInvoiceCustomer({ name: ' Demo New ', phone: '0300 3330000', customerId: '', extra: 'x', op: 'setInvoiceCustomer' }))
      .toEqual({ ok: true, who: { name: 'Demo New', phone: '+923003330000' } });
    expect(cleanInvoiceCustomer({ name: 'Demo Customer', customerId: ' cust-1 ', phone: '+923001110000' }))
      .toEqual({ ok: true, who: { name: 'Demo Customer', customerId: 'cust-1', phone: '+923001110000' } });
    expect(cleanInvoiceCustomer({ name: 'Demo New', phone: '', customerId: null })).toEqual({ ok: true, who: { name: 'Demo New' } });
  });

  it('refuses what the dialog would not send', () => {
    for (const body of [
      null, [], 'Demo', {}, { name: '' }, { name: '  ' }, { name: 'Walk-in Customer' }, { name: 42 },
      { name: 'x'.repeat(201) }, { name: 'Demo', customerId: 7 }, { name: 'Demo', customerId: 'a/b' },
      { name: 'Demo', phone: 3001234567 }, { name: 'Demo', phone: '1'.repeat(41) },
    ]) {
      expect(cleanInvoiceCustomer(body).ok, JSON.stringify(body)).toBe(false);
    }
    expect(cleanInvoiceCustomer({ name: 'walk in' })).toEqual({ ok: false, error: NAME_NEEDED });
  });
});
