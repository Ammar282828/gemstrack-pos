import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import {
  addExtraRevenue, deleteExpense, deleteExtraRevenue, drawingEntryOf, expenseFieldsFrom, LedgerRowRefusal,
  revenueFieldsFrom, updateExpense, updateExtraRevenue, type ExpenseFields,
} from './expense-admin';

// An in-memory database behind the port, ids drawn in turn. All names and amounts made up.
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  let ids = 0;
  let commits = 0;
  const col = (c: string) => (data[c] ??= {});
  const apply = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };
  const db: DbPort = {
    async runTransaction(fn) {
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => apply(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => apply(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      commits += 1;
      return out;
    },
    async queryEquals(c, field, value) {
      return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never);
    },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { apply(c, id, d, true); },
    batch() {
      const writes: (() => void)[] = [];
      return {
        set(c, id, d, merge) { writes.push(() => apply(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => apply(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
        async commit() { writes.forEach((w) => w()); commits += 1; },
      };
    },
    newId(c) { ids += 1; return `${c}-${ids}`; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data, commits: () => commits };
}

const DAY = '2026-10-05T07:00:00.000Z';
const LATER = '2026-10-06T07:00:00.000Z';
const fields = (over: Partial<ExpenseFields> = {}): ExpenseFields =>
  ({ date: DAY, category: 'Utilities', description: 'Electricity bill', amount: 12_000, paidBy: 'business', ...over });

describe('the expense form\'s fields', () => {
  it('takes what the schema takes, with the business paying unless a partner did', () => {
    expect(expenseFieldsFrom({ date: DAY, category: ' Utilities ', description: ' Electricity bill ', amount: 12_000, extra: 'dropped' }))
      .toEqual({ ok: true, value: fields() });
    expect(expenseFieldsFrom({ date: DAY, category: 'Karigar', description: 'Wages', amount: 5_000, paidBy: 'mina', karigarId: 'kar-1', batchId: 'b-1' }))
      .toEqual({ ok: true, value: { date: DAY, category: 'Karigar', description: 'Wages', amount: 5_000, paidBy: 'mina', karigarId: 'kar-1', batchId: 'b-1' } });
    // A hisaab only with its karigar; a partner only on a salary.
    expect(expenseFieldsFrom({ ...fields(), batchId: 'b-1', shareholderId: 'mina' })).toEqual({ ok: true, value: fields() });
    expect(expenseFieldsFrom({ ...fields(), category: 'Partner Salary', shareholderId: 'ammar' }))
      .toEqual({ ok: true, value: fields({ category: 'Partner Salary', shareholderId: 'ammar' }) });
  });

  it('refuses a field of the wrong shape', () => {
    for (const body of [
      { ...fields(), date: 'someday' }, { ...fields(), date: undefined }, { ...fields(), category: '' }, { ...fields(), description: ' ' },
      { ...fields(), amount: 0 }, { ...fields(), amount: '12000' }, { ...fields(), amount: -5 }, { ...fields(), paidBy: 'zaid' },
      { ...fields(), karigarId: 'a/b' }, { ...fields(), karigarId: 7 }, { ...fields(), category: 'Partner Salary', shareholderId: 'zaid' },
    ]) {
      expect(expenseFieldsFrom(body as Record<string, unknown>).ok).toBe(false);
    }
  });
});

describe('editing an expense', () => {
  it('keeps a partner\'s loan row when the payer, amount and day stay, giving it the new words', async () => {
    const { db, data, commits } = fakeDb({
      expenses: { e1: { ...fields({ paidBy: 'mina' }), ledgerEntryId: 'l1' } },
      mina_ledger: { l1: { type: 'payment', category: 'loan', description: 'Expense paid: Electricity bill', amount: 12_000, linkedExpenseId: 'e1' } },
    });
    const logged: string[][] = [];
    const saved = await updateExpense(db, 'e1', fields({ paidBy: 'mina', description: 'Electricity, September' }), { log: (a, t, d, r) => { logged.push([a, t, d, r ?? '']); } });
    expect(data.mina_ledger.l1).toMatchObject({ description: 'Expense paid: Electricity, September', amount: 12_000 });
    expect(data.expenses.e1).toMatchObject({ description: 'Electricity, September', ledgerEntryId: 'l1', paidBy: 'mina' });
    expect(saved).toMatchObject({ id: 'e1', ledgerEntryId: 'l1' });
    expect(commits()).toBe(1);
    expect(logged).toEqual([['expense.update', 'Updated expense: Electricity, September', 'ID: e1', 'e1']]);
  });

  it('a day sent again as the form\'s ISO text is the same day', async () => {
    const { db, data } = fakeDb({
      expenses: { e1: { ...fields({ paidBy: 'mina', date: '2026-10-05T07:00:00Z' }), ledgerEntryId: 'l1' } },
      mina_ledger: { l1: { type: 'payment', amount: 12_000, linkedExpenseId: 'e1' } },
    });
    await updateExpense(db, 'e1', fields({ paidBy: 'mina' }));
    expect(Object.keys(data.mina_ledger)).toEqual(['l1']);
  });

  it('moves the loan to the new payer, or a new row for a new amount or day, and drops it for the business', async () => {
    const { db, data } = fakeDb({
      expenses: { e1: { ...fields({ paidBy: 'mina' }), ledgerEntryId: 'l1' } },
      mina_ledger: { l1: { type: 'payment', amount: 12_000, linkedExpenseId: 'e1' } },
    });
    await updateExpense(db, 'e1', fields({ paidBy: 'ammar' }));
    expect(data.mina_ledger).toEqual({});
    expect(data.ammar_ledger['ammar_ledger-1']).toEqual({
      type: 'payment', category: 'loan', description: 'Expense paid: Electricity bill', amount: 12_000,
      date: { ts: DAY }, createdAt: 'server-time', linkedExpenseId: 'e1',
    });
    expect(data.expenses.e1.ledgerEntryId).toBe('ammar_ledger-1');

    await updateExpense(db, 'e1', fields({ paidBy: 'ammar', amount: 13_000, date: LATER }));
    expect(Object.keys(data.ammar_ledger)).toEqual(['ammar_ledger-2']);
    expect(data.ammar_ledger['ammar_ledger-2']).toMatchObject({ amount: 13_000, date: { ts: LATER } });

    const saved = await updateExpense(db, 'e1', fields({ amount: 13_000, date: LATER }));
    expect(data.ammar_ledger).toEqual({});
    expect(data.expenses.e1).toMatchObject({ paidBy: 'business', ledgerEntryId: null });
    expect(saved).not.toHaveProperty('ledgerEntryId');
  });

  it('clears a karigar, hisaab or partner taken off the row', async () => {
    const { db, data } = fakeDb({
      expenses: { e1: { ...fields({ category: 'Karigar' }), karigarId: 'kar-1', batchId: 'b-1', shareholderId: 'mina' } },
    });
    await updateExpense(db, 'e1', fields());
    expect(data.expenses.e1).toMatchObject({ category: 'Utilities', karigarId: null, batchId: null, shareholderId: null });
  });

  it('refuses an expense not on file, and a partner\'s drawing, which is the ledger\'s', async () => {
    const { db, data } = fakeDb({
      expenses: { d1: fields({ category: 'Partner Drawings', description: 'Mina — school fees', amount: 40_000 }) },
      mina_ledger: { w1: { type: 'withdrawal', category: 'equity', amount: 40_000, linkedExpenseId: 'd1' } },
    });
    await expect(updateExpense(db, 'e9', fields())).rejects.toThrow('No such expense.');
    await expect(updateExpense(db, 'd1', fields({ category: 'Partner Drawings', amount: 1 }))).rejects.toThrow(LedgerRowRefusal);
    await expect(updateExpense(db, 'd1', fields())).rejects.toThrow(/Mina's drawing.*Shareholders/);
    expect(data.expenses.d1.amount).toBe(40_000);
  });
});

describe('a partner\'s drawing', () => {
  it('is a Partner Drawings expense a withdrawal points at; a loan row pointing at an expense is not one', async () => {
    const { db } = fakeDb({
      ammar_ledger: { w1: { type: 'withdrawal', linkedExpenseId: 'd1' }, l1: { type: 'payment', linkedExpenseId: 'd2' } },
    });
    expect(await drawingEntryOf(db, { id: 'd1', category: 'Partner Drawings' })).toEqual({ partner: 'ammar', name: 'Ammar', entryId: 'w1' });
    expect(await drawingEntryOf(db, { id: 'd2', category: 'Partner Drawings' })).toBeNull();
    expect(await drawingEntryOf(db, { id: 'd1', category: 'Utilities' })).toBeNull();
    // An old drawing with no ledger row is an ordinary expense.
    expect(await drawingEntryOf(db, { id: 'd3', category: 'Partner Drawings' })).toBeNull();
  });
});

describe('deleting an expense', () => {
  it('takes a partner\'s loan row with it, in one commit', async () => {
    const { db, data, commits } = fakeDb({
      expenses: { e1: { ...fields({ paidBy: 'ammar' }), ledgerEntryId: 'l1' }, e2: fields() },
      ammar_ledger: { l1: { type: 'payment', linkedExpenseId: 'e1' }, l2: { type: 'payment', description: 'Capital' } },
    });
    const logged: string[][] = [];
    expect(await deleteExpense(db, 'e1', { log: (a, t, d, r) => { logged.push([a, t, d, r ?? '']); } })).toEqual({ expenseId: 'e1', ledgerEntryId: 'l1' });
    expect(Object.keys(data.expenses)).toEqual(['e2']);
    expect(Object.keys(data.ammar_ledger)).toEqual(['l2']);
    expect(commits()).toBe(1);
    expect(logged).toEqual([['expense.delete', 'Deleted expense: Electricity bill', 'ID: e1', 'e1']]);
    expect(await deleteExpense(db, 'e2')).toEqual({ expenseId: 'e2' });
  });

  it('refuses one already gone, and a partner\'s drawing', async () => {
    const { db, data } = fakeDb({
      expenses: { d1: fields({ category: 'Partner Drawings' }) },
      mina_ledger: { w1: { type: 'withdrawal', linkedExpenseId: 'd1' } },
    });
    await expect(deleteExpense(db, 'e9')).rejects.toThrow('No such expense.');
    await expect(deleteExpense(db, 'd1')).rejects.toThrow(/Delete it on Shareholders/);
    expect(data.expenses.d1).toBeDefined();
  });
});

describe('extra revenue', () => {
  it('takes the form\'s three fields and refuses anything else', () => {
    expect(revenueFieldsFrom({ date: DAY, description: ' Commission ', amount: 5_000, repairId: 'REP-1' }))
      .toEqual({ ok: true, value: { date: DAY, description: 'Commission', amount: 5_000 } });
    for (const body of [{ date: DAY, description: '', amount: 1 }, { date: 'x', description: 'a', amount: 1 }, { date: DAY, description: 'a', amount: 0 }]) {
      expect(revenueFieldsFrom(body).ok).toBe(false);
    }
  });

  it('adds, edits and deletes a row, keeping what the form does not show', async () => {
    const { db, data } = fakeDb({ additional_revenue: { web1: { date: DAY, description: 'Delivery charge', amount: 300, orderId: 'ORD-1' } } });
    const logged: string[] = [];
    const fx = { log: (a: string) => { logged.push(a); } };
    const added = await addExtraRevenue(db, { date: DAY, description: 'Commission', amount: 5_000 }, fx);
    expect(added).toEqual({ id: 'additional_revenue-1', date: DAY, description: 'Commission', amount: 5_000 });
    expect(data.additional_revenue[added.id]).toEqual({ date: DAY, description: 'Commission', amount: 5_000 });

    const edited = await updateExtraRevenue(db, 'web1', { date: LATER, description: 'Delivery charge, Lahore', amount: 350 }, fx);
    expect(data.additional_revenue.web1).toEqual({ date: LATER, description: 'Delivery charge, Lahore', amount: 350, orderId: 'ORD-1' });
    expect(edited).toMatchObject({ id: 'web1', orderId: 'ORD-1' });

    expect(await deleteExtraRevenue(db, added.id, fx)).toEqual({ revenueId: added.id });
    expect(Object.keys(data.additional_revenue)).toEqual(['web1']);
    expect(logged).toEqual(['revenue.create', 'revenue.update', 'revenue.delete']);
  });

  it('refuses money taken on a repair, and a row not on file', async () => {
    const row = { date: DAY, description: 'Repair REP-000001: Gold ring', amount: 1_000, repairId: 'REP-000001' };
    const { db, data } = fakeDb({ additional_revenue: { r1: row } });
    await expect(updateExtraRevenue(db, 'r1', { date: DAY, description: 'x', amount: 1 })).rejects.toThrow(/Change this on the repair/);
    await expect(deleteExtraRevenue(db, 'r1')).rejects.toThrow(LedgerRowRefusal);
    await expect(deleteExtraRevenue(db, 'r9')).rejects.toThrow('No such revenue entry.');
    await expect(updateExtraRevenue(db, 'r9', { date: DAY, description: 'x', amount: 1 })).rejects.toThrow('No such revenue entry.');
    expect(data.additional_revenue.r1).toEqual(row);
  });
});
