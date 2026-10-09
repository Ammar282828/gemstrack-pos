import { describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';

// lib/shareholders.ts reads the ledgers in the browser; only its list of partners is wanted here.
vi.mock('@/lib/firebase', () => ({ db: {} }));
const { addShareholderEntry, deletePartnerSalary, deleteShareholderEntry, partnershipSettingsFrom, saveWorkingCapitalFloor } = await import('./shareholders');

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
    async queryEquals() { return []; },
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

const logger = () => {
  const lines: string[][] = [];
  return { lines, fx: { log: (a: string, t: string, d: string, id?: string) => { lines.push([a, t, d, id ?? '']); } } };
};

describe('a contribution', () => {
  it('is one ledger row, dated by the form\'s day, and nothing in Expenses', async () => {
    const { db, data } = fakeDb({});
    const out = await addShareholderEntry(db, { who: 'mina', kind: 'contribution', category: 'loan', description: 'Bank transfer', amount: 50_000, date: '2026-10-09' });
    expect(out).toEqual({ entryId: 'mina_ledger-1' });
    expect(data.mina_ledger['mina_ledger-1']).toEqual({
      type: 'payment', category: 'loan', description: 'Bank transfer', amount: 50_000,
      date: { ts: '2026-10-09T00:00:00.000Z' }, createdAt: 'server-time',
    });
    expect(data.expenses).toBeUndefined();
  });
});

describe('a withdrawal', () => {
  it('is the draw and its Partner Drawings expense, the business\'s, pointing at each other, in one commit', async () => {
    const { db, data, commits } = fakeDb({});
    const { fx, lines } = logger();
    const out = await addShareholderEntry(db, { who: 'ammar', kind: 'withdrawal', category: 'equity', description: 'Capital returned', amount: 25_000, date: '2026-10-01' }, fx);
    expect(out).toEqual({ entryId: 'ammar_ledger-1', expenseId: 'expenses-2' });
    expect(commits()).toBe(1);
    expect(data.expenses['expenses-2']).toEqual({
      date: '2026-10-01T00:00:00.000Z', category: 'Partner Drawings', description: 'Ammar — Capital returned', amount: 25_000, paidBy: 'business',
    });
    expect(data.ammar_ledger['ammar_ledger-1']).toEqual({
      type: 'withdrawal', category: 'equity', description: 'Capital returned', amount: 25_000,
      date: { ts: '2026-10-01T00:00:00.000Z' }, createdAt: 'server-time', linkedExpenseId: 'expenses-2',
    });
    expect(lines).toEqual([['expense.create', 'Added expense: Ammar — Capital returned', 'Category: Partner Drawings | Amount: 25,000', 'expenses-2']]);
  });

  it('refuses a partner the house does not have, and a day it cannot read', async () => {
    const { db } = fakeDb({});
    await expect(addShareholderEntry(db, { who: 'someone' as never, kind: 'contribution', category: 'equity', description: 'x', amount: 1, date: '2026-10-01' })).rejects.toThrow('No such shareholder.');
    await expect(addShareholderEntry(db, { who: 'mina', kind: 'contribution', category: 'equity', description: 'x', amount: 1, date: 'soon' })).rejects.toThrow('A date is needed.');
  });
});

describe('deleting a ledger entry', () => {
  it('takes a draw\'s expense with it, logged as the store logs a deleted expense', async () => {
    const { db, data } = fakeDb({
      mina_ledger: { m1: { type: 'withdrawal', amount: 10_000, linkedExpenseId: 'exp-1' }, m2: { type: 'payment', amount: 5 } },
      expenses: { 'exp-1': { description: 'Mina — Capital returned', category: 'Partner Drawings', paidBy: 'business', amount: 10_000 }, 'exp-2': { description: 'Rent' } },
    });
    const { fx, lines } = logger();
    expect(await deleteShareholderEntry(db, { who: 'mina', entryId: 'm1' }, fx)).toEqual({ entryId: 'm1', expenseId: 'exp-1' });
    expect(Object.keys(data.mina_ledger)).toEqual(['m2']);
    expect(Object.keys(data.expenses)).toEqual(['exp-2']);
    expect(lines).toEqual([['expense.delete', 'Deleted expense: Mina — Capital returned', 'ID: exp-1', 'exp-1']]);
  });

  it('an entry with no expense (or a "pending" link) is just the entry, and is not logged', async () => {
    const { db, data } = fakeDb({ ammar_ledger: { a1: { amount: 1 }, a2: { amount: 2, linkedExpenseId: 'pending' } }, expenses: { pending: { description: 'Not this' } } });
    const { fx, lines } = logger();
    await deleteShareholderEntry(db, { who: 'ammar', entryId: 'a1' }, fx);
    await deleteShareholderEntry(db, { who: 'ammar', entryId: 'a2' }, fx);
    expect(data.ammar_ledger).toEqual({});
    expect(Object.keys(data.expenses)).toEqual(['pending']);
    expect(lines).toEqual([]);
  });

  it('a partner-fronted expense\'s loan row: the entry and its expense go, and the expense\'s pairing is not deleted twice', async () => {
    const { db, data } = fakeDb({
      mina_ledger: { m9: { type: 'payment', category: 'loan', description: 'Expense paid: Polish', linkedExpenseId: 'exp-9' } },
      expenses: { 'exp-9': { description: 'Polish', paidBy: 'mina', ledgerEntryId: 'm9' } },
    });
    await deleteShareholderEntry(db, { who: 'mina', entryId: 'm9' });
    expect(data.mina_ledger).toEqual({});
    expect(data.expenses).toEqual({});
  });

  it('an entry that is not on file is said so', async () => {
    const { db } = fakeDb({});
    await expect(deleteShareholderEntry(db, { who: 'mina', entryId: 'nope' })).rejects.toThrow('No such ledger entry.');
  });
});

describe('deleting a salary payment', () => {
  it('deletes the salary expense, logged as the store logs it', async () => {
    const { db, data } = fakeDb({ expenses: { s1: { description: 'Mina salary — September', category: 'Partner Salary', paidBy: 'business', shareholderId: 'mina' } } });
    const { fx, lines } = logger();
    await deletePartnerSalary(db, { expenseId: 's1' }, fx);
    expect(data.expenses).toEqual({});
    expect(lines).toEqual([['expense.delete', 'Deleted expense: Mina salary — September', 'ID: s1', 's1']]);
  });

  it('never another kind of expense', async () => {
    const { db, data } = fakeDb({ expenses: { r1: { description: 'Rent', category: 'Rent' } } });
    await expect(deletePartnerSalary(db, { expenseId: 'r1' })).rejects.toThrow('Not a partner salary.');
    await expect(deletePartnerSalary(db, { expenseId: 'gone' })).rejects.toThrow('No such expense.');
    expect(Object.keys(data.expenses)).toEqual(['r1']);
  });
});

describe('the working-capital floor', () => {
  it('reads as loadPartnershipSettings reads it', () => {
    expect(partnershipSettingsFrom(null)).toEqual({ workingCapitalFloor: 500_000, floorHistory: [] });
    expect(partnershipSettingsFrom({ workingCapitalFloor: '0', floorHistory: 'odd' })).toEqual({ workingCapitalFloor: 500_000, floorLastSetAt: undefined, floorHistory: [] });
    expect(partnershipSettingsFrom({ workingCapitalFloor: 300_000, floorLastSetAt: '2026-10-01T05:00:00.000Z', floorHistory: [{ value: 300_000, date: '2026-10-01T05:00:00.000Z' }] }))
      .toEqual({ workingCapitalFloor: 300_000, floorLastSetAt: '2026-10-01T05:00:00.000Z', floorHistory: [{ value: 300_000, date: '2026-10-01T05:00:00.000Z' }] });
  });

  it('is stamped and its change kept, but the same value twice is one line of history', async () => {
    const { db, data } = fakeDb({ app_settings: { partnership: { workingCapitalFloor: 500_000, floorHistory: [{ value: 500_000, date: '2026-09-01T05:00:00.000Z' }], note: 'kept' } } });
    const { fx, lines } = logger();
    const first = await saveWorkingCapitalFloor(db, { value: 400_000, by: 'Shareholders', now: new Date('2026-10-02T06:00:00.000Z') }, fx);
    expect(first).toEqual({
      workingCapitalFloor: 400_000, floorLastSetAt: '2026-10-02T06:00:00.000Z',
      floorHistory: [{ value: 500_000, date: '2026-09-01T05:00:00.000Z' }, { value: 400_000, date: '2026-10-02T06:00:00.000Z', by: 'Shareholders' }],
    });
    expect(data.app_settings.partnership).toEqual({ ...first, note: 'kept', updatedAt: 'server-time' });
    const again = await saveWorkingCapitalFloor(db, { value: 400_000, now: new Date('2026-10-03T06:00:00.000Z') });
    expect(again.floorHistory).toHaveLength(2);
    expect(again.floorLastSetAt).toBe('2026-10-03T06:00:00.000Z');
    expect(lines).toEqual([['settings.update', 'Working capital floor set', 'workingCapitalFloor · by Shareholders', '']]);
  });
});
