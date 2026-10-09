import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handlers write through. All names and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };

const port: DbPort = {
  async runTransaction(fn) { return fn({ async get() { return null; }, set() {}, update() {}, delete() {} }); },
  async queryEquals(c, field, value) { return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never); },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add() { return 'x'; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { writes.forEach((w) => w()); },
    };
  },
  newId() { return 'n1'; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { CUSTOMER_OPS, runCustomerOp } = await import('./ops-customers');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runCustomerOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  codeChecks.length = 0;
  put('customers', 'cust-1', { name: 'Demo Keeper' });
  put('customers', 'cust-2', { name: 'Demo Duplicate' });
  put('customers', 'cust-gone', { name: 'Demo Removed', deletedAt: '2026-10-01T00:00:00.000Z' });
  put('invoices', 'INV-000001', { customerId: 'cust-2', customerName: 'Demo Duplicate' });
  put('orders', 'ORD-000001', { customerId: 'cust-2', customerName: 'Demo Duplicate' });
  put('hisaab', 'h1', { entityId: 'cust-2', entityType: 'customer', entityName: 'Demo Duplicate', cashDebit: 500 });
  put('given_items', 'g1', { recipientId: 'cust-2', recipientName: 'Demo Duplicate' });
});

describe('who may run the customer operations', () => {
  it('owners only, as the browser\'s direct writes are', () => {
    expect(CUSTOMER_OPS).toEqual({ removeCustomer: ['owner'], mergeCustomers: ['owner'] });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await run('updateCustomer', {})).toBeNull();
  });
});

describe('removeCustomer', () => {
  it('hides the customer once the delete code is right, and answers with who and when', async () => {
    const r = await run('removeCustomer', { customerId: 'cust-2', deleteCode: '4321' });
    expect(r?.status).toBe(200);
    expect(r?.body).toMatchObject({ ok: true, id: 'cust-2', name: 'Demo Duplicate', followUps: [] });
    expect(typeof r?.body.deletedAt).toBe('string');
    expect(col('customers')['cust-2'].deletedAt).toBe(r?.body.deletedAt);
    expect(col('invoices')['INV-000001'].customerId).toBe('cust-2');
    expect(codeChecks).toEqual(['Delete customer Demo Duplicate']);
    expect(logged).toEqual([['customer.delete', 'Removed customer: Demo Duplicate', 'ID: cust-2', 'cust-2']]);
  });

  it('touches nothing on a wrong or missing code', async () => {
    expect(await run('removeCustomer', { customerId: 'cust-2', deleteCode: '0000' })).toMatchObject({ status: 403, body: { error: 'Wrong code.' } });
    expect((await run('removeCustomer', { customerId: 'cust-2' }))?.status).toBe(403);
    expect(col('customers')['cust-2'].deletedAt).toBeUndefined();
    expect(logged).toEqual([]);
  });

  it('says a customer who is gone or already removed before it asks for the code', async () => {
    expect(await run('removeCustomer', { customerId: 'cust-nobody', deleteCode: '4321' })).toMatchObject({ status: 409, body: { error: 'No such customer.' } });
    expect(await run('removeCustomer', { customerId: 'cust-gone', deleteCode: '4321' })).toMatchObject({ status: 409, body: { error: 'Demo Removed has already been removed.' } });
    expect((await run('removeCustomer', { deleteCode: '4321' }))?.status).toBe(400);
    expect((await run('removeCustomer', { customerId: 'a/b', deleteCode: '4321' }))?.status).toBe(400);
    expect(codeChecks).toEqual([]);
  });
});

describe('mergeCustomers', () => {
  it('moves the duplicate\'s records to the customer kept and deletes it, once the code is right', async () => {
    const r = await run('mergeCustomers', { keepId: 'cust-1', deleteId: 'cust-2', deleteCode: '4321' });
    expect(r?.status).toBe(200);
    expect(r?.body).toMatchObject({ ok: true, invoices: 1, orders: 1, hisaab: 1, given: 1, updatedDocs: 4, keptId: 'cust-1', deletedId: 'cust-2', followUps: [] });
    expect(col('invoices')['INV-000001']).toMatchObject({ customerId: 'cust-1', customerName: 'Demo Keeper' });
    expect(col('orders')['ORD-000001']).toMatchObject({ customerId: 'cust-1', customerName: 'Demo Keeper' });
    expect(col('hisaab').h1).toMatchObject({ entityId: 'cust-1', entityName: 'Demo Keeper' });
    expect(col('given_items').g1).toMatchObject({ recipientId: 'cust-1', recipientName: 'Demo Keeper' });
    expect(col('customers')['cust-2']).toBeUndefined();
    expect(codeChecks).toEqual(['Merge, and delete customer Demo Duplicate']);
    expect(logged).toEqual([['customer.delete', 'Merged customer "Demo Duplicate" into "Demo Keeper"', 'Deleted ID: cust-2, Kept ID: cust-1, Updated 4 records', 'cust-1']]);
  });

  it('touches nothing on a wrong code', async () => {
    expect((await run('mergeCustomers', { keepId: 'cust-1', deleteId: 'cust-2', deleteCode: '1111' }))?.status).toBe(403);
    expect(col('invoices')['INV-000001'].customerId).toBe('cust-2');
    expect(col('customers')['cust-2']).toBeTruthy();
    expect(logged).toEqual([]);
  });

  it('refuses a pair that is not a merge before it asks for the code', async () => {
    const ask = (keepId: unknown, deleteId: unknown) => run('mergeCustomers', { keepId, deleteId, deleteCode: '4321' });
    expect(await ask('cust-1', 'cust-1')).toMatchObject({ status: 400, body: { error: 'Choose two different customers.' } });
    expect((await ask('cust-1', undefined))?.status).toBe(400);
    expect((await ask('cust-1', 'a/b'))?.status).toBe(400);
    expect(await ask('cust-1', 'cust-nobody')).toMatchObject({ status: 409, body: { error: 'One or both customers not found' } });
    expect((await ask('cust-gone', 'cust-2'))?.status).toBe(409);
    expect((await ask('cust-1', 'cust-gone'))?.status).toBe(409);
    expect(codeChecks).toEqual([]);
    expect(col('customers')['cust-2']).toBeTruthy();
  });
});
