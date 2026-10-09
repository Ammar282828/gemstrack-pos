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
  async queryEquals() { return []; },
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
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));

const { PEOPLE_OPS, runPeopleOp } = await import('./ops-people');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runPeopleOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  put('customers', 'cust-1', { id: 'cust-1', name: 'Demo Customer', phone: '+923001110000', ringSize: '12', tags: ['tj'] });
  put('customers', 'cust-gone', { id: 'cust-gone', name: 'Old Customer', deletedAt: '2026-10-01T00:00:00.000Z' });
  put('karigars', 'k1', { id: 'k1', name: 'Ustad Demo', city: 'Testville' });
});

describe('who may run the people operations', () => {
  it('owners only, as the browser\'s direct Firestore writes are', () => {
    expect(PEOPLE_OPS).toEqual({ updateCustomer: ['owner'], addKarigar: ['owner'], updateKarigar: ['owner'] });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runPeopleOp('recordPayment', {}, ctx())).toBeNull();
  });
});

describe('updateCustomer', () => {
  it('saves the form\'s fields, normalised, and answers with the document as it is on file', async () => {
    const r = await run('updateCustomer', { customerId: 'cust-1', patch: { name: ' Demo Renamed ', phone: '0300 2223333', city: 'Testville', birthday: '1990-06-30', source: 'walkin', deletedAt: 'x', tags: [] } });
    expect(r?.status).toBe(200);
    expect(r?.body.ok).toBe(true);
    expect(r?.body.followUps).toEqual([]);
    expect(data.customers['cust-1']).toEqual({
      id: 'cust-1', name: 'Demo Renamed', phone: '+923002223333', city: 'Testville', birthday: '1990-06-30', source: 'walkin', ringSize: '12', tags: ['tj'],
    });
    expect(r?.body.customer).toEqual({ ...data.customers['cust-1'], id: 'cust-1' });
    expect(logged).toEqual([['customer.update', 'Updated customer: Demo Renamed', 'ID: cust-1', 'cust-1']]);
  });

  it('refuses a bad body with a 400 and writes nothing', async () => {
    const before = structuredClone(data.customers['cust-1']);
    for (const body of [
      { patch: { name: 'x' } },
      { customerId: 'a/b', patch: { name: 'x' } },
      { customerId: 'cust-1' },
      { customerId: 'cust-1', patch: {} },
      { customerId: 'cust-1', patch: { email: 'nope' } },
      { customerId: 'cust-1', patch: { phone: 3001234567 } },
      { customerId: 'cust-1', patch: { source: 'friend' } },
    ]) {
      expect((await run('updateCustomer', body))?.status, JSON.stringify(body)).toBe(400);
    }
    expect(data.customers['cust-1']).toEqual(before);
    expect(logged).toEqual([]);
  });

  it('refuses a customer who is not on file, or was removed, with a 409', async () => {
    expect((await run('updateCustomer', { customerId: 'nobody', patch: { name: 'x' } }))?.status).toBe(409);
    expect((await run('updateCustomer', { customerId: 'cust-gone', patch: { name: 'x' } }))?.status).toBe(409);
    expect(data.customers.nobody).toBeUndefined();
    expect(data.customers['cust-gone'].name).toBe('Old Customer');
  });
});

describe('addKarigar', () => {
  it('adds a karigar with only the form\'s fields, the login email lowercase', async () => {
    const r = await run('addKarigar', { karigar: { name: ' Ustad New ', contact: '03001230000', email: 'New.K@Example.com', city: '', id: 'k1', deletedAt: 'x' } });
    expect(r?.status).toBe(200);
    const k = r?.body.karigar as { id: string };
    expect(k.id).toMatch(/^karigar-/);
    expect(data.karigars[k.id]).toEqual({ id: k.id, name: 'Ustad New', contact: '+923001230000', email: 'new.k@example.com', city: '' });
    expect(data.karigars.k1.name).toBe('Ustad Demo');
    expect(logged).toEqual([['karigar.create', 'Created karigar: Ustad New', `ID: ${k.id}`, k.id]]);
  });

  it('needs a name', async () => {
    expect((await run('addKarigar', { karigar: { city: 'Testville' } }))?.status).toBe(400);
    expect((await run('addKarigar', {}))?.status).toBe(400);
    expect(Object.keys(data.karigars)).toEqual(['k1']);
  });
});

describe('updateKarigar', () => {
  it('saves the fields sent and keeps the rest', async () => {
    const r = await run('updateKarigar', { karigarId: 'k1', patch: { notes: 'Fridays off', specialty: 'polish' } });
    expect(r?.status).toBe(200);
    expect(data.karigars.k1).toEqual({ id: 'k1', name: 'Ustad Demo', city: 'Testville', notes: 'Fridays off', specialty: 'polish' });
    expect((r?.body.karigar as { notes: string }).notes).toBe('Fridays off');
    expect(logged).toEqual([['karigar.update', 'Updated karigar: k1', 'ID: k1', 'k1']]);
  });

  it('refuses a blank name, a bad email and a karigar who is not on file', async () => {
    expect((await run('updateKarigar', { karigarId: 'k1', patch: { name: ' ' } }))?.status).toBe(400);
    expect((await run('updateKarigar', { karigarId: 'k1', patch: { email: 'nope' } }))?.status).toBe(400);
    expect((await run('updateKarigar', { karigarId: 'nobody', patch: { city: 'x' } }))?.status).toBe(409);
    expect(data.karigars.k1).toEqual({ id: 'k1', name: 'Ustad Demo', city: 'Testville' });
  });
});
