import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handler writes through. All names and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
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
  async queryEquals(c, field, value) {
    return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never);
  },
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

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { LEDGER_OPS, runLedgerOp } = await import('./ops-ledger');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runLedgerOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

const DAY = '2026-10-05T07:00:00.000Z';
const bill = { date: DAY, category: 'Utilities', description: 'Electricity bill', amount: 12_000, paidBy: 'business' };

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  logged = [];
  codeChecks.length = 0;
});

describe('who may run the ledger operations', () => {
  it('owners only, as the pages are', () => {
    expect(LEDGER_OPS).toEqual({
      updateExpense: ['owner'], deleteExpense: ['owner'],
      addExtraRevenue: ['owner'], updateExtraRevenue: ['owner'], deleteExtraRevenue: ['owner'],
    });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runLedgerOp('addExpense', {}, ctx())).toBeNull();
  });
});

describe('updateExpense', () => {
  it('saves the form over the row, and a partner\'s cash goes on the ledger as a loan', async () => {
    put('expenses', 'e1', bill);
    const r = await run('updateExpense', { expenseId: 'e1', ...bill, description: ' Electricity, September ', paidBy: 'mina', ledgerEntryId: 'forged' });
    expect(r?.status).toBe(200);
    expect(data.expenses.e1).toMatchObject({ description: 'Electricity, September', paidBy: 'mina', ledgerEntryId: 'mina_ledger-1' });
    expect(data.mina_ledger['mina_ledger-1']).toMatchObject({ type: 'payment', category: 'loan', amount: 12_000, linkedExpenseId: 'e1' });
    expect((r?.body.expense as Record<string, unknown>).id).toBe('e1');
    expect(logged[0][0]).toBe('expense.update');
  });

  it('refuses a body of the wrong shape, a row not on file and a partner\'s drawing', async () => {
    put('expenses', 'e1', bill);
    expect((await run('updateExpense', { ...bill }))?.status).toBe(400);
    expect((await run('updateExpense', { expenseId: 'e1', ...bill, amount: 0 }))?.status).toBe(400);
    expect((await run('updateExpense', { expenseId: 'e1', ...bill, paidBy: 'someone' }))?.status).toBe(400);
    expect(await run('updateExpense', { expenseId: 'e9', ...bill })).toEqual({ status: 409, body: { error: 'No such expense.' } });
    put('expenses', 'd1', { ...bill, category: 'Partner Drawings' });
    put('ammar_ledger', 'w1', { type: 'withdrawal', linkedExpenseId: 'd1' });
    const r = await run('updateExpense', { expenseId: 'd1', ...bill, category: 'Partner Drawings', amount: 1 });
    expect(r?.status).toBe(409);
    expect(r?.body.error).toMatch(/Ammar's drawing/);
    expect(data.expenses.d1.amount).toBe(12_000);
    expect(data.expenses.e1).toEqual(bill);
  });
});

describe('deleteExpense', () => {
  it('asks for the code in the store\'s words, then deletes the row and a partner\'s loan with it', async () => {
    put('expenses', 'e1', { ...bill, paidBy: 'ammar', ledgerEntryId: 'l1' });
    put('ammar_ledger', 'l1', { type: 'payment', linkedExpenseId: 'e1' });
    expect(await run('deleteExpense', { expenseId: 'e1', deleteCode: '1111' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect(data.expenses.e1).toBeDefined();
    const r = await run('deleteExpense', { expenseId: 'e1', deleteCode: '4321' });
    expect(r).toEqual({ status: 200, body: { ok: true, expenseId: 'e1', ledgerEntryId: 'l1', followUps: [] } });
    expect(data.expenses).toEqual({});
    expect(data.ammar_ledger).toEqual({});
    expect(codeChecks).toEqual(['Delete expense "Electricity bill"', 'Delete expense "Electricity bill"']);
  });

  it('says a row is gone, or is a partner\'s drawing, before the code is asked for', async () => {
    put('expenses', 'd1', { ...bill, category: 'Partner Drawings' });
    put('mina_ledger', 'w1', { type: 'withdrawal', linkedExpenseId: 'd1' });
    expect(await run('deleteExpense', { expenseId: 'e9', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'No such expense.' } });
    const r = await run('deleteExpense', { expenseId: 'd1', deleteCode: '4321' });
    expect(r?.status).toBe(409);
    expect(r?.body.error).toMatch(/Delete it on Shareholders/);
    expect(await run('deleteExpense', { deleteCode: '4321' })).toEqual({ status: 400, body: { error: 'Which expense?' } });
    expect(codeChecks).toEqual([]);
    expect(data.expenses.d1).toBeDefined();
  });
});

describe('extra revenue', () => {
  it('adds and edits with the form\'s fields only', async () => {
    const added = await run('addExtraRevenue', { date: DAY, description: 'Commission', amount: 5_000, repairId: 'REP-000001' });
    expect(added?.status).toBe(200);
    const id = (added?.body.revenue as { id: string }).id;
    expect(data.additional_revenue[id]).toEqual({ date: DAY, description: 'Commission', amount: 5_000 });
    const edited = await run('updateExtraRevenue', { revenueId: id, date: DAY, description: 'Commission, October', amount: 5_500 });
    expect(edited?.status).toBe(200);
    expect(data.additional_revenue[id]).toEqual({ date: DAY, description: 'Commission, October', amount: 5_500 });
    expect((await run('addExtraRevenue', { date: DAY, description: '', amount: 5 }))?.status).toBe(400);
    expect((await run('updateExtraRevenue', { date: DAY, description: 'a', amount: 5 }))?.status).toBe(400);
    expect(logged.map((l) => l[0])).toEqual(['revenue.create', 'revenue.update']);
  });

  it('asks for the code to delete, and refuses money taken on a repair before asking', async () => {
    put('additional_revenue', 'x1', { date: DAY, description: 'Commission', amount: 5_000 });
    put('additional_revenue', 'r1', { date: DAY, description: 'Repair REP-000001', amount: 1_000, repairId: 'REP-000001' });
    const repair = await run('deleteExtraRevenue', { revenueId: 'r1', deleteCode: '4321' });
    expect(repair?.status).toBe(409);
    expect(repair?.body.error).toMatch(/^Change this on the repair/);
    expect((await run('updateExtraRevenue', { revenueId: 'r1', date: DAY, description: 'x', amount: 1 }))?.status).toBe(409);
    expect(await run('deleteExtraRevenue', { revenueId: 'r9', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'No such revenue entry.' } });
    expect(codeChecks).toEqual([]);
    expect((await run('deleteExtraRevenue', { revenueId: 'x1', deleteCode: '0000' }))?.status).toBe(403);
    expect(await run('deleteExtraRevenue', { revenueId: 'x1', deleteCode: '4321' })).toEqual({ status: 200, body: { ok: true, revenueId: 'x1', followUps: [] } });
    expect(Object.keys(data.additional_revenue)).toEqual(['r1']);
    expect(codeChecks).toEqual(['Delete this extra revenue', 'Delete this extra revenue']);
  });
});
