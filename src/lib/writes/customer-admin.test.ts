import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import { CustomerRefusal, mergeCounts, mergeCustomers, mergeFill, planCustomerMerge, removeCustomer } from './customer-admin';

// An in-memory database behind the port. All names and amounts made up.
type Data = Record<string, Record<string, Record<string, unknown>>>;
let data: Data;
let commits: number;
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };

const db: DbPort = {
  async runTransaction(fn) { return fn({ async get() { return null; }, set() {}, update() {}, delete() {} }); },
  async queryEquals(c, field, value) { return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never); },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add() { return 'x'; },
  async update(c, id, d) { if (!col(c)[id]) throw new Error('NOT_FOUND'); put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { commits += 1; writes.forEach((w) => w()); },
    };
  },
  newId() { return 'n1'; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};

const logger = () => {
  const lines: string[][] = [];
  return { lines, fx: { log: (a: string, t: string, d: string, r?: string) => { lines.push([a, t, d, r ?? '']); } } };
};

beforeEach(() => {
  commits = 0;
  data = {
    customers: {
      'cust-1': { name: 'Demo Keeper', phone: '03001112223' },
      'cust-2': { name: 'Demo Keeper (second)', phone: '03001112223' },
      'cust-3': { name: 'Demo Bystander' },
      'cust-gone': { name: 'Demo Removed', deletedAt: '2026-10-01T00:00:00.000Z' },
    },
    invoices: {
      'INV-000001': { customerId: 'cust-2', customerName: 'Demo Keeper (second)', grandTotal: 1000 },
      'INV-000002': { customerId: 'cust-1', customerName: 'Demo Keeper', grandTotal: 2000 },
      'INV-000003': { customerId: 'cust-2', customerName: 'Demo Keeper (second)', grandTotal: 3000 },
      'INV-000004': { customerId: 'cust-3', customerName: 'Demo Bystander', grandTotal: 4000 },
    },
    orders: {
      'ORD-000001': { customerId: 'cust-2', customerName: 'Demo Keeper (second)' },
      'ORD-000002': { customerId: 'cust-3', customerName: 'Demo Bystander' },
    },
    hisaab: {
      h1: { entityId: 'cust-2', entityType: 'customer', entityName: 'Demo Keeper (second)', cashDebit: 500 },
      h2: { entityId: 'cust-2', entityType: 'karigar', entityName: 'Not a customer row', goldDebitGrams: 2 },
      h3: { entityId: 'cust-1', entityType: 'customer', entityName: 'Demo Keeper', cashCredit: 100 },
    },
    given_items: {
      g1: { recipientId: 'cust-2', recipientName: 'Demo Keeper (second)', description: 'Sample ring' },
      g2: { recipientId: 'cust-3', recipientName: 'Demo Bystander', description: 'Sample chain' },
    },
    repairs: {
      'REP-1': { customerId: 'cust-2', customerName: 'Demo Keeper (second)' },
    },
  };
});

describe('removeCustomer', () => {
  it('hides the customer and leaves their history where it is, as the store does', async () => {
    const { lines, fx } = logger();
    const out = await removeCustomer(db, 'cust-2', fx, { now: new Date('2026-10-09T08:00:00.000Z') });
    expect(out).toEqual({ id: 'cust-2', name: 'Demo Keeper (second)', deletedAt: '2026-10-09T08:00:00.000Z' });
    expect(data.customers['cust-2']).toMatchObject({ name: 'Demo Keeper (second)', deletedAt: '2026-10-09T08:00:00.000Z' });
    expect(data.invoices['INV-000001'].customerId).toBe('cust-2');
    expect(data.hisaab.h1.entityId).toBe('cust-2');
    expect(lines).toEqual([['customer.delete', 'Removed customer: Demo Keeper (second)', 'ID: cust-2', 'cust-2']]);
  });

  it('names a customer by their id when they have no name', async () => {
    data.customers['cust-4'] = { phone: '0300' };
    const { lines, fx } = logger();
    expect((await removeCustomer(db, 'cust-4', fx)).name).toBe('cust-4');
    expect(lines[0][1]).toBe('Removed customer: cust-4');
  });

  it('refuses a customer who is not there, or is removed already, and writes nothing', async () => {
    const { lines, fx } = logger();
    await expect(removeCustomer(db, 'cust-nobody', fx)).rejects.toThrow('No such customer.');
    await expect(removeCustomer(db, 'cust-gone', fx)).rejects.toThrow(CustomerRefusal);
    await expect(removeCustomer(db, 'cust-gone', fx)).rejects.toThrow('Demo Removed has already been removed.');
    expect(data.customers['cust-gone'].deletedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(lines).toEqual([]);
  });
});

describe('planCustomerMerge', () => {
  it('counts what follows the duplicate, the customer\'s own hisaab rows only, and writes nothing', async () => {
    const plan = await planCustomerMerge(db, 'cust-1', 'cust-2');
    expect(plan.keep).toEqual({ id: 'cust-1', name: 'Demo Keeper' });
    expect(plan.duplicate).toEqual({ id: 'cust-2', name: 'Demo Keeper (second)' });
    expect(mergeCounts(plan)).toEqual({ invoices: 2, orders: 1, hisaab: 1, given: 1, repairs: 1 });
    expect(plan.invoices.sort()).toEqual(['INV-000001', 'INV-000003']);
    expect(commits).toBe(0);
    expect(data.invoices['INV-000001'].customerId).toBe('cust-2');
  });

  it('refuses one customer twice, a customer who is not there, and a removed one', async () => {
    await expect(planCustomerMerge(db, 'cust-1', 'cust-1')).rejects.toThrow('Choose two different customers.');
    await expect(planCustomerMerge(db, 'cust-1', 'cust-nobody')).rejects.toThrow('One or both customers not found');
    await expect(planCustomerMerge(db, 'cust-nobody', 'cust-2')).rejects.toThrow(CustomerRefusal);
    await expect(planCustomerMerge(db, 'cust-1', 'cust-gone')).rejects.toThrow('One or both customers not found');
    await expect(planCustomerMerge(db, 'cust-gone', 'cust-2')).rejects.toThrow('One or both customers not found');
  });
});

describe('mergeCustomers', () => {
  it('moves the duplicate\'s invoices, orders, repairs, hisaab and given items to the kept customer, then deletes the duplicate', async () => {
    const { lines, fx } = logger();
    const out = await mergeCustomers(db, 'cust-1', 'cust-2', fx);
    expect(out).toEqual({ invoices: 2, orders: 1, hisaab: 1, given: 1, repairs: 1, updatedDocs: 6, keptId: 'cust-1', deletedId: 'cust-2', filled: [] });
    expect(data.repairs['REP-1']).toMatchObject({ customerId: 'cust-1', customerName: 'Demo Keeper' });

    expect(data.invoices['INV-000001']).toMatchObject({ customerId: 'cust-1', customerName: 'Demo Keeper', grandTotal: 1000 });
    expect(data.invoices['INV-000003']).toMatchObject({ customerId: 'cust-1', customerName: 'Demo Keeper' });
    expect(data.orders['ORD-000001']).toMatchObject({ customerId: 'cust-1', customerName: 'Demo Keeper' });
    expect(data.hisaab.h1).toMatchObject({ entityId: 'cust-1', entityName: 'Demo Keeper', cashDebit: 500 });
    expect(data.given_items.g1).toMatchObject({ recipientId: 'cust-1', recipientName: 'Demo Keeper', description: 'Sample ring' });
    expect(data.customers['cust-2']).toBeUndefined();
    expect(data.customers['cust-1']).toEqual({ name: 'Demo Keeper', phone: '03001112223' });
    expect(commits).toBe(1);

    expect(lines).toEqual([[
      'customer.delete',
      'Merged customer "Demo Keeper (second)" into "Demo Keeper"',
      'Deleted ID: cust-2, Kept ID: cust-1, Updated 6 records',
      'cust-1',
    ]]);
  });

  it('leaves everyone else\'s records and a karigar\'s hisaab row with the same id as they were', async () => {
    await mergeCustomers(db, 'cust-1', 'cust-2');
    expect(data.invoices['INV-000002']).toMatchObject({ customerId: 'cust-1' });
    expect(data.invoices['INV-000004']).toMatchObject({ customerId: 'cust-3', customerName: 'Demo Bystander' });
    expect(data.orders['ORD-000002']).toMatchObject({ customerId: 'cust-3' });
    expect(data.hisaab.h2).toMatchObject({ entityId: 'cust-2', entityType: 'karigar' });
    expect(data.hisaab.h3).toMatchObject({ entityId: 'cust-1' });
    expect(data.given_items.g2).toMatchObject({ recipientId: 'cust-3' });
  });

  it('merges a duplicate with nothing of its own by deleting it', async () => {
    const out = await mergeCustomers(db, 'cust-1', 'cust-3');
    expect(out).toMatchObject({ invoices: 1, orders: 1, hisaab: 0, given: 1, updatedDocs: 3 });
    expect(Object.keys(data.customers)).toEqual(['cust-1', 'cust-2', 'cust-gone']);
    data.customers['cust-5'] = { name: 'Demo Nothing' };
    expect(await mergeCustomers(db, 'cust-1', 'cust-5')).toMatchObject({ updatedDocs: 0 });
    expect(data.customers['cust-5']).toBeUndefined();
  });

  it('commits in chunks well inside Firestore\'s limit, the duplicate\'s record in the last one', async () => {
    for (let i = 0; i < 1000; i++) data.invoices[`INV-B${i}`] = { customerId: 'cust-2', customerName: 'Demo Keeper (second)' };
    const out = await mergeCustomers(db, 'cust-1', 'cust-2');
    expect(out.updatedDocs).toBe(1006);
    // 1006 updates and the delete: 1007 writes, 450 to a batch.
    expect(commits).toBe(3);
    expect(Object.values(data.invoices).filter((i) => i.customerId === 'cust-2')).toEqual([]);
    expect(data.customers['cust-2']).toBeUndefined();
  });

  it('changes nothing when the two are not a merge', async () => {
    await expect(mergeCustomers(db, 'cust-1', 'cust-gone')).rejects.toThrow('One or both customers not found');
    await expect(mergeCustomers(db, 'cust-1', 'cust-1')).rejects.toThrow('Choose two different customers.');
    expect(commits).toBe(0);
    expect(data.invoices['INV-000001'].customerId).toBe('cust-2');
    expect(Object.keys(data.customers)).toHaveLength(4);
  });
});

describe('mergeFill', () => {
  it('gives the kept customer each detail it has no value for, and never overwrites one it has', async () => {
    data.customers['cust-1'] = { name: 'Demo Keeper', phone: '03001112223', address: '', ringSize: '12' };
    data.customers['cust-2'] = { name: 'Demo Keeper (second)', phone: '03001112223', address: 'Demo Street 1', ringSize: '14', email: 'demo@example.com', deletedAt: null };
    const out = await mergeCustomers(db, 'cust-1', 'cust-2');
    expect(out.filled.sort()).toEqual(['address', 'email']);
    expect(data.customers['cust-1']).toEqual({ name: 'Demo Keeper', phone: '03001112223', address: 'Demo Street 1', ringSize: '12', email: 'demo@example.com' });
  });

  it('keeps the duplicate\'s other number in the spare slot, never the main number twice', () => {
    expect(mergeFill({ phone: '+923001112223' }, { phone: '+923004445556' })).toEqual({ altPhone: '+923004445556' });
    expect(mergeFill({ phone: '+923001112223' }, { phone: '0300 111 2223' })).toEqual({});
    expect(mergeFill({ phone: '+923001112223', altPhone: '+923009990000' }, { phone: '+923004445556' })).toEqual({});
    expect(mergeFill({ phone: '+923001112223' }, { altPhone: '+923001112223' })).toEqual({});
    expect(mergeFill({}, { phone: '+923004445556', altPhone: '+923007778889' })).toEqual({ phone: '+923004445556', altPhone: '+923007778889' });
  });

  it('never carries the record\'s own fields: its name, removal, dates or Shopify link', () => {
    expect(mergeFill({ name: 'A' }, { name: 'B', deletedAt: 'x', createdAt: 'y', shopifyCustomerId: 'z', id: 'cust-2' })).toEqual({});
  });
});
