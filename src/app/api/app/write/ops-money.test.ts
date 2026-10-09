import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handler writes through. All names and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
const REMOVE = '<field removed>';
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
  const next: Record<string, unknown> = merge ? { ...col(c)[id], ...d } : { ...d };
  for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
  col(c)[id] = next;
};

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
  newId(c) { ids += 1; return `${c}-${ids}`; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};

// The house's delete code is "4321" here; the partnership is switched per test.
let partnership = true;
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => REMOVE } }));
vi.mock('@/lib/store-config', () => ({ get STORE_PARTNERSHIP() { return partnership; } }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { MONEY_OPS, runMoneyOp } = await import('./ops-money');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runMoneyOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  logged = [];
  codeChecks.length = 0;
  partnership = true;
});

describe('who may run the money operations', () => {
  it('owners only, as the pages are', () => {
    expect(MONEY_OPS).toEqual({
      saveOverheadPlan: ['owner'], addShareholderEntry: ['owner'], deleteShareholderEntry: ['owner'], deletePartnerSalary: ['owner'],
      setWorkingCapitalFloor: ['owner'], restoreRemoved: ['owner'], purgeRemoved: ['owner'],
    });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runMoneyOp('addExpense', {}, ctx())).toBeNull();
  });
});

describe('saveOverheadPlan', () => {
  it('saves the sheet from this month on and answers with what is on file', async () => {
    put('app_settings', 'global', { shopName: 'Demo Shop', overheadPlans: [{ from: '2026-09', items: [{ id: 'rent', label: 'Rent', amount: 10_000 }] }] });
    const r = await run('saveOverheadPlan', { items: [{ id: 'rent', label: ' Rent ', amount: 12_000 }, { id: 'item-2', label: '', amount: 0 }] });
    expect(r?.status).toBe(200);
    expect(r?.body.items).toEqual([{ id: 'rent', label: 'Rent', amount: 12_000 }]);
    const plans = col('app_settings').global.overheadPlans as { from: string }[];
    expect(plans[0]).toEqual({ from: '2026-09', items: [{ id: 'rent', label: 'Rent', amount: 10_000 }] });
    expect(plans.at(-1)).toEqual({ from: r?.body.from, items: [{ id: 'rent', label: 'Rent', amount: 12_000 }] });
    expect(col('app_settings').global.shopName).toBe('Demo Shop');
    expect(logged[0][0]).toBe('settings.update');
  });

  it('refuses a sheet of the wrong shape and writes nothing', async () => {
    for (const items of [
      undefined, 'rent', [{ id: 'a', label: 'A', amount: -1 }], [{ id: 'a', label: 'A', amount: '100' }],
      [{ id: 'a', label: 'A', amount: 1 }, { id: 'a', label: 'B', amount: 2 }], [{ id: '', label: 'A', amount: 1 }],
      [{ id: 'a/b', label: 'A', amount: 1 }], [{ id: 'a', label: 7, amount: 1 }], [null],
    ]) {
      expect((await run('saveOverheadPlan', { items }))?.status).toBe(400);
    }
    expect(data.app_settings).toBeUndefined();
  });
});

describe('addShareholderEntry', () => {
  it('a contribution goes on the partner\'s ledger as the page writes it', async () => {
    const r = await run('addShareholderEntry', { shareholderId: 'mina', kind: 'contribution', category: 'equity', description: ' Bank transfer ', amount: 75_000, date: '2026-10-09' });
    expect(r).toEqual({ status: 200, body: { ok: true, entryId: 'mina_ledger-1', followUps: [] } });
    expect(col('mina_ledger')['mina_ledger-1']).toMatchObject({ type: 'payment', category: 'equity', description: 'Bank transfer', amount: 75_000, date: { ts: '2026-10-09T00:00:00.000Z' } });
  });

  it('a withdrawal writes its Partner Drawings expense too', async () => {
    const r = await run('addShareholderEntry', { shareholderId: 'ammar', kind: 'withdrawal', category: 'loan', description: 'Loan repaid', amount: 20_000, date: '2026-10-08' });
    expect(r?.body).toMatchObject({ ok: true, entryId: 'ammar_ledger-1', expenseId: 'expenses-2' });
    expect(col('expenses')['expenses-2']).toMatchObject({ category: 'Partner Drawings', description: 'Ammar — Loan repaid', paidBy: 'business' });
    expect(logged.map(l => l[0])).toEqual(['expense.create']);
  });

  it('refuses what the page\'s form refuses, and a house with no partnership', async () => {
    const ok = { shareholderId: 'mina', kind: 'contribution', category: 'equity', description: 'x', amount: 1, date: '2026-10-09' };
    for (const patch of [
      { shareholderId: 'someone' }, { kind: 'salary' }, { category: 'gift' }, { description: '  ' }, { amount: 0 }, { amount: '500' },
      { amount: Number.POSITIVE_INFINITY }, { date: '9 Oct' }, { date: '2026-13-45' },
    ]) {
      expect((await run('addShareholderEntry', { ...ok, ...patch }))?.status).toBe(400);
    }
    partnership = false;
    expect(await run('addShareholderEntry', ok)).toEqual({ status: 403, body: { error: 'This shop keeps no partner ledgers.' } });
    expect(data.mina_ledger).toBeUndefined();
  });
});

describe('deleteShareholderEntry', () => {
  beforeEach(() => {
    put('mina_ledger', 'm1', { type: 'withdrawal', amount: 10_000, linkedExpenseId: 'exp-1' });
    put('expenses', 'exp-1', { description: 'Mina — Capital returned', category: 'Partner Drawings', paidBy: 'business' });
  });

  it('asks for the delete code, then takes the entry and its expense', async () => {
    const r = await run('deleteShareholderEntry', { shareholderId: 'mina', entryId: 'm1', deleteCode: '4321' });
    expect(r?.body).toEqual({ ok: true, entryId: 'm1', expenseId: 'exp-1', followUps: [] });
    expect(codeChecks).toEqual(['Delete this Mina ledger entry']);
    expect(col('mina_ledger')).toEqual({});
    expect(col('expenses')).toEqual({});
  });

  it('a wrong code deletes nothing', async () => {
    expect(await run('deleteShareholderEntry', { shareholderId: 'mina', entryId: 'm1', deleteCode: '0000' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect(Object.keys(col('mina_ledger'))).toEqual(['m1']);
    expect(Object.keys(col('expenses'))).toEqual(['exp-1']);
  });

  it('an entry not on file is said before the code is asked for', async () => {
    expect(await run('deleteShareholderEntry', { shareholderId: 'mina', entryId: 'gone', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'No such ledger entry.' } });
    expect((await run('deleteShareholderEntry', { shareholderId: 'mina', entryId: 'a/b', deleteCode: '4321' }))?.status).toBe(400);
    expect(codeChecks).toEqual([]);
  });
});

describe('deletePartnerSalary', () => {
  it('a salary payment goes with the code; any other expense is refused before it is asked', async () => {
    put('expenses', 's1', { description: 'Mina salary — September', category: 'Partner Salary', shareholderId: 'mina' });
    put('expenses', 'r1', { description: 'Rent', category: 'Rent' });
    expect((await run('deletePartnerSalary', { expenseId: 'r1', deleteCode: '4321' }))?.status).toBe(400);
    expect((await run('deletePartnerSalary', { expenseId: 'gone', deleteCode: '4321' }))?.status).toBe(409);
    expect((await run('deletePartnerSalary', { expenseId: 's1', deleteCode: '0000' }))?.status).toBe(403);
    expect(Object.keys(col('expenses'))).toEqual(['s1', 'r1']);
    expect((await run('deletePartnerSalary', { expenseId: 's1', deleteCode: '4321' }))?.body).toEqual({ ok: true, expenseId: 's1', followUps: [] });
    expect(Object.keys(col('expenses'))).toEqual(['r1']);
    expect(codeChecks).toEqual(['Delete expense "Mina salary — September"', 'Delete expense "Mina salary — September"']);
    expect(logged).toEqual([['expense.delete', 'Deleted expense: Mina salary — September', 'ID: s1', 's1']]);
  });
});

describe('setWorkingCapitalFloor', () => {
  it('saves the floor as set by Shareholders, as the page\'s floor names it', async () => {
    const r = await run('setWorkingCapitalFloor', { value: 350_000 });
    expect(r?.status).toBe(200);
    expect(col('app_settings').partnership).toMatchObject({ workingCapitalFloor: 350_000, floorHistory: [{ value: 350_000, by: 'Shareholders' }] });
  });

  it('a floor is a figure of 0 or more', async () => {
    for (const value of [-1, '350000', null, Number.NaN]) expect((await run('setWorkingCapitalFloor', { value }))?.status).toBe(400);
    partnership = false;
    expect((await run('setWorkingCapitalFloor', { value: 1 }))?.status).toBe(403);
  });
});

describe('restoreRemoved and purgeRemoved', () => {
  beforeEach(() => {
    put('customers', 'cust-1', { name: 'Removed Customer', deletedAt: '2026-10-01T05:00:00.000Z' });
    put('customers', 'cust-2', { name: 'Live Customer' });
    put('karigars', 'kar-1', { name: 'Removed Karigar', deletedAt: '2026-10-02T05:00:00.000Z' });
  });

  it('puts people back without asking for the code', async () => {
    const r = await run('restoreRemoved', { customerIds: ['cust-1', 'cust-2'], karigarIds: ['kar-1'] });
    expect(r?.body).toEqual({ ok: true, customers: ['cust-1'], karigars: ['kar-1'], followUps: [] });
    expect(col('customers')['cust-1']).toEqual({ name: 'Removed Customer' });
    expect(codeChecks).toEqual([]);
    expect(logged.map(l => l[1])).toEqual(['Restored customer: Removed Customer', 'Restored karigar: Removed Karigar']);
  });

  it('emptying asks for the code and deletes only the removed', async () => {
    expect((await run('purgeRemoved', { customerIds: ['cust-1', 'cust-2'], karigarIds: ['kar-1'], deleteCode: '0000' }))?.status).toBe(403);
    expect(Object.keys(col('customers'))).toEqual(['cust-1', 'cust-2']);
    const r = await run('purgeRemoved', { customerIds: ['cust-1', 'cust-2'], karigarIds: ['kar-1'], deleteCode: '4321' });
    expect(r?.body).toEqual({ ok: true, customers: 1, karigars: 1, followUps: [] });
    expect(Object.keys(col('customers'))).toEqual(['cust-2']);
    expect(col('karigars')).toEqual({});
    expect(codeChecks).toEqual(['Delete every removed customer and karigar for good', 'Delete every removed customer and karigar for good']);
  });

  it('refuses a list that is not one, or names nobody', async () => {
    expect((await run('restoreRemoved', { customerIds: 'cust-1' }))?.status).toBe(400);
    expect((await run('restoreRemoved', { customerIds: ['cust-1', ''] }))?.status).toBe(400);
    expect((await run('restoreRemoved', {}))?.status).toBe(400);
    expect((await run('purgeRemoved', { customerIds: [], karigarIds: [], deleteCode: '4321' }))?.status).toBe(400);
    expect(codeChecks).toEqual([]);
  });
});
