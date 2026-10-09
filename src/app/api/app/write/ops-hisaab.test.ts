import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handlers write through. All names and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
const col = (c: string) => (data[c] ??= {});

const port: DbPort = {
  async runTransaction(fn) { return fn({ async get() { return null; }, set() {}, update() {}, delete() {} }); },
  async queryEquals() { return []; },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add(c, d) { const id = `${c}-${++ids}`; col(c)[id] = { ...d }; return id; },
  async update() {},
  batch() {
    const writes: (() => void)[] = [];
    return {
      set() {}, update() {},
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

const { HISAAB_OPS, runHisaabOp } = await import('./ops-hisaab');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runHisaabOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  logged = [];
  codeChecks.length = 0;
  col('customers')['cust-1'] = { name: 'Demo Customer' };
  col('customers')['cust-gone'] = { name: 'Demo Removed', deletedAt: '2026-10-01T00:00:00.000Z' };
  col('karigars')['kar-1'] = { name: 'Demo Karigar' };
  col('hisaab')['h1'] = { entityId: 'cust-1', entityType: 'customer', entityName: 'Demo Customer', description: 'Cash lent', cashDebit: 5000 };
});

const gave = { entityId: 'cust-1', entityType: 'customer', mode: 'gave', description: 'Cash payment', amount: 2500, goldGrams: 0 };

describe('who may run the hisaab operations', () => {
  it('owners only, as the book is', () => {
    expect(HISAAB_OPS).toEqual({ addHisaabEntry: ['owner'], deleteHisaabEntry: ['owner'] });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await run('syncHisaab', {})).toBeNull();
  });
});

describe('addHisaabEntry', () => {
  it('writes the row the ledger page writes, named as the customer is on file', async () => {
    const r = await run('addHisaabEntry', { ...gave, entityName: 'Anyone Else', date: '1999-01-01', linkedInvoiceId: 'INV-000009' });
    expect(r?.status).toBe(200);
    const entry = r?.body.entry as Record<string, unknown>;
    expect(entry).toMatchObject({
      entityId: 'cust-1', entityType: 'customer', entityName: 'Demo Customer', description: 'Cash payment',
      cashDebit: 2500, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0,
    });
    expect(Math.abs(Date.now() - new Date(entry.date as string).getTime())).toBeLessThan(60_000);
    expect(col('hisaab')[entry.id as string]).toMatchObject({ entityName: 'Demo Customer', cashDebit: 2500 });
    expect('linkedInvoiceId' in col('hisaab')[entry.id as string]).toBe(false);
    expect(r?.body.followUps).toEqual([]);
    expect(codeChecks).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('writes a karigar\'s metal as a credit when you got it', async () => {
    const r = await run('addHisaabEntry', { entityId: 'kar-1', entityType: 'karigar', mode: 'got', description: 'Scrap returned', amount: 0, goldGrams: 4.125 });
    expect(r?.status).toBe(200);
    expect(r?.body.entry).toMatchObject({ entityName: 'Demo Karigar', cashDebit: 0, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 4.125 });
  });

  it('refuses what the dialog refuses, and writes nothing', async () => {
    for (const patch of [{ description: ' ' }, { amount: -5 }, { amount: 0, goldGrams: 0 }, { mode: 'lent' }, { entityType: 'walk-in' }, { entityId: '' }]) {
      expect((await run('addHisaabEntry', { ...gave, ...patch }))?.status).toBe(400);
    }
    expect(Object.keys(col('hisaab'))).toEqual(['h1']);
  });

  it('is for a customer or karigar on file: the page says "Entity not found" for anyone else', async () => {
    const words = 'Entity not found. It may have been deleted.';
    expect(await run('addHisaabEntry', { ...gave, entityId: 'cust-nobody' })).toMatchObject({ status: 409, body: { error: words } });
    expect(await run('addHisaabEntry', { ...gave, entityId: 'cust-gone' })).toMatchObject({ status: 409, body: { error: words } });
    expect((await run('addHisaabEntry', { ...gave, entityId: 'walk-in' }))?.status).toBe(409);
    // A karigar's id is not a customer's.
    expect((await run('addHisaabEntry', { ...gave, entityId: 'kar-1' }))?.status).toBe(409);
    expect(Object.keys(col('hisaab'))).toEqual(['h1']);
  });
});

describe('deleteHisaabEntry', () => {
  it('deletes the row once the delete code is right', async () => {
    const r = await run('deleteHisaabEntry', { entryId: 'h1', deleteCode: '4321' });
    expect(r).toEqual({ status: 200, body: { ok: true, id: 'h1', entityId: 'cust-1', description: 'Cash lent', followUps: [] } });
    expect(col('hisaab')['h1']).toBeUndefined();
    expect(codeChecks).toEqual(['Delete this ledger entry']);
  });

  it('keeps the row on a wrong or missing code', async () => {
    expect(await run('deleteHisaabEntry', { entryId: 'h1', deleteCode: '0000' })).toMatchObject({ status: 403, body: { error: 'Wrong code.' } });
    expect((await run('deleteHisaabEntry', { entryId: 'h1' }))?.status).toBe(403);
    expect(col('hisaab')['h1']).toBeTruthy();
  });

  it('says a row that is gone before it asks for the code', async () => {
    expect(await run('deleteHisaabEntry', { entryId: 'h-nobody', deleteCode: '4321' })).toMatchObject({ status: 409, body: { error: 'No such ledger entry.' } });
    expect((await run('deleteHisaabEntry', { deleteCode: '4321' }))?.status).toBe(400);
    expect((await run('deleteHisaabEntry', { entryId: 'a/b', deleteCode: '4321' }))?.status).toBe(400);
    expect(codeChecks).toEqual([]);
  });
});
