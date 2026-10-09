import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handler writes through. All data made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };

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
  async queryEquals(c, field, value) { return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never); },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add() { return 'x'; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() { throw new Error('not used'); },
  newId() { return 'n1'; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));

const { INVOICE_OPS, runInvoiceOp } = await import('./ops-invoices');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runInvoiceOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

const SALE = { customerName: 'Walk-in Customer', subtotal: 40000, grandTotal: 40000, amountPaid: 10000, balanceDue: 30000, items: [{ sku: 'RNG-001' }] };

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  put('invoices', 'INV-900001', { ...SALE });
  put('customers', 'cust-1', { id: 'cust-1', name: 'Demo Customer', phone: '+923001110000' });
  put('hisaab', 'h1', { entityId: 'walk-in', entityType: 'customer', entityName: 'Walk-in Customer', linkedInvoiceId: 'INV-900001', cashDebit: 30000 });
  put('hisaab', 'h2', { entityId: 'cust-9', entityName: 'Someone Else', linkedInvoiceId: 'INV-900009', cashDebit: 500 });
});

describe('who may run the invoice operations', () => {
  it('owners only, as the browser\'s own Firestore transaction is', () => {
    expect(INVOICE_OPS).toEqual({ setInvoiceCustomer: ['owner'] });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runInvoiceOp('recordPayment', {}, ctx())).toBeNull();
  });
});

describe('setInvoiceCustomer', () => {
  it('a customer picked from the book: the invoice and its ledger row are theirs, and the invoice comes back', async () => {
    const r = await run('setInvoiceCustomer', { invoiceId: 'INV-900001', customerId: 'cust-1', name: 'Demo Customer', phone: '+923001110000', grandTotal: 1 });
    expect(r?.status).toBe(200);
    expect(r?.body.ok).toBe(true);
    expect(r?.body.followUps).toEqual([]);
    expect(data.invoices['INV-900001']).toEqual({ ...SALE, customerId: 'cust-1', customerName: 'Demo Customer', customerContact: '+923001110000' });
    expect(r?.body.invoice).toEqual({ ...data.invoices['INV-900001'], id: 'INV-900001' });
    expect(data.hisaab.h1).toMatchObject({ entityId: 'cust-1', entityName: 'Demo Customer', entityType: 'customer', cashDebit: 30000 });
    expect(data.hisaab.h2).toEqual({ entityId: 'cust-9', entityName: 'Someone Else', linkedInvoiceId: 'INV-900009', cashDebit: 500 });
    expect(logged).toEqual([['invoice.update', 'Customer set on invoice INV-900001', 'Walk-in Customer → Demo Customer', 'INV-900001']]);
  });

  it('a name typed makes the customer, the number as the ERP keeps it', async () => {
    const r = await run('setInvoiceCustomer', { invoiceId: 'INV-900001', name: ' Demo New ', phone: '0300 3330000' });
    expect(r?.status).toBe(200);
    const inv = r?.body.invoice as { customerId: string; customerName: string; customerContact: string };
    expect(inv.customerId).toMatch(/^cust-/);
    expect(inv).toMatchObject({ customerName: 'Demo New', customerContact: '+923003330000' });
    expect(data.customers[inv.customerId]).toEqual({ name: 'Demo New', phone: '+923003330000', address: '', email: '' });
    expect(data.hisaab.h1).toMatchObject({ entityId: inv.customerId, entityName: 'Demo New' });
  });

  it('refuses a bad body with a 400 and writes nothing', async () => {
    const before = structuredClone(data);
    for (const body of [
      { name: 'Demo New' },
      { invoiceId: 'INV/1', name: 'Demo New' },
      { invoiceId: 'INV-900001' },
      { invoiceId: 'INV-900001', name: ' ' },
      { invoiceId: 'INV-900001', name: 'Walk-in Customer' },
      { invoiceId: 'INV-900001', name: 'Demo', customerId: 'a/b' },
      { invoiceId: 'INV-900001', name: 'Demo', phone: 3003330000 },
    ]) {
      expect((await run('setInvoiceCustomer', body))?.status, JSON.stringify(body)).toBe(400);
    }
    expect(data).toEqual(before);
    expect(logged).toEqual([]);
  });

  it('refuses an invoice that is not on file with a 409', async () => {
    const r = await run('setInvoiceCustomer', { invoiceId: 'INV-404', name: 'Demo New' });
    expect(r?.status).toBe(409);
    expect(r?.body.error).toBe('Invoice INV-404 not found.');
    expect(Object.keys(data.customers)).toEqual(['cust-1']);
  });
});
