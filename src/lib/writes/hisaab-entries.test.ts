import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import { addHisaabEntry, cleanHisaabEntry, deleteHisaabEntry, HisaabRefusal } from './hisaab-entries';
import { planHisaabSync } from './hisaab-sync';

// An in-memory database behind the port. All names and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
const col = (c: string) => (data[c] ??= {});
const db: DbPort = {
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

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
});

const form = { entityId: 'cust-1', entityType: 'customer', mode: 'gave', description: 'Cash lent', amount: 5000, goldGrams: 0 };

describe('cleanHisaabEntry (the ledger dialog\'s own checks)', () => {
  it('keeps the fields the dialog has, trimmed, and nothing else', () => {
    expect(cleanHisaabEntry({ ...form, description: '  Cash lent  ', date: '1999-01-01', cashDebit: 99, linkedInvoiceId: 'INV-000001' }))
      .toEqual({ ok: true, data: { entityId: 'cust-1', entityType: 'customer', mode: 'gave', description: 'Cash lent', amount: 5000, goldGrams: 0 } });
  });

  it('takes a missing amount or weight as 0, as the dialog\'s defaults do', () => {
    expect(cleanHisaabEntry({ ...form, amount: undefined, goldGrams: 2.5 })).toMatchObject({ ok: true, data: { amount: 0, goldGrams: 2.5 } });
    expect(cleanHisaabEntry({ ...form, goldGrams: undefined })).toMatchObject({ ok: true, data: { amount: 5000, goldGrams: 0 } });
  });

  it('refuses what the dialog refuses, in its words', () => {
    const err = (patch: Record<string, unknown>, metalWord?: string) => {
      const r = cleanHisaabEntry({ ...form, ...patch }, { metalWord });
      return r.ok ? null : r.error;
    };
    expect(err({ description: '   ' })).toBe('Description is required');
    expect(err({ description: undefined })).toBe('Description is required');
    expect(err({ amount: -1 })).toBe('Amount must be non-negative');
    expect(err({ goldGrams: -0.5 }, 'Silver')).toBe('Silver must be non-negative');
    expect(err({ goldGrams: -0.5 })).toBe('Gold must be non-negative');
    expect(err({ amount: 0, goldGrams: 0 })).toBe('Enter a cash amount or gold grams — both cannot be zero.');
  });

  it('refuses a body that is not a hisaab entry', () => {
    const err = (v: unknown) => { const r = cleanHisaabEntry(v); return r.ok ? null : r.error; };
    expect(err(null)).toBe('Nothing to save.');
    expect(err([form])).toBe('Nothing to save.');
    expect(err({ ...form, entityId: '' })).toBe('Whose hisaab?');
    expect(err({ ...form, entityId: 'a/b' })).toBe('Whose hisaab?');
    expect(err({ ...form, entityType: 'supplier' })).toBe('A customer or a karigar.');
    expect(err({ ...form, mode: 'borrowed' })).toBe('You gave, or you got.');
    expect(err({ ...form, amount: '500' })).toBe('Amount must be non-negative');
    expect(err({ ...form, amount: Number.NaN })).toBe('Amount must be non-negative');
    expect(err({ ...form, amount: Number.POSITIVE_INFINITY })).toBe('Amount must be non-negative');
    expect(err({ ...form, goldGrams: 1e9 })).toBe('Gold must be non-negative');
    expect(err({ ...form, description: 'x'.repeat(501) })).toMatch(/at most 500/);
  });
});

describe('addHisaabEntry', () => {
  const now = new Date('2026-10-09T08:30:00.000Z');

  it('"You gave" is a debit of the cash and the metal given, dated now and named as the person is on file', async () => {
    const entry = await addHisaabEntry(db, { ...form, goldGrams: 1.25 } as never, 'Demo Customer', { now });
    expect(entry).toEqual({
      id: 'hisaab-1', entityId: 'cust-1', entityType: 'customer', entityName: 'Demo Customer', date: '2026-10-09T08:30:00.000Z',
      description: 'Cash lent', cashDebit: 5000, cashCredit: 0, goldDebitGrams: 1.25, goldCreditGrams: 0,
    });
    expect(col('hisaab')['hisaab-1']).toEqual({
      entityId: 'cust-1', entityType: 'customer', entityName: 'Demo Customer', date: '2026-10-09T08:30:00.000Z',
      description: 'Cash lent', cashDebit: 5000, cashCredit: 0, goldDebitGrams: 1.25, goldCreditGrams: 0,
    });
    expect('linkedInvoiceId' in col('hisaab')['hisaab-1']).toBe(false);
  });

  it('"You got" is a credit, a karigar\'s metal as the same kind of row', async () => {
    const entry = await addHisaabEntry(db, { entityId: 'kar-1', entityType: 'karigar', mode: 'got', description: 'Returned scrap', amount: 0, goldGrams: 3.5 }, 'Demo Karigar', { now });
    expect(entry).toMatchObject({ entityType: 'karigar', cashDebit: 0, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 3.5 });
    const cash = await addHisaabEntry(db, { ...form, mode: 'got', amount: 700 } as never, '', { now });
    expect(cash).toMatchObject({ entityName: '', cashDebit: 0, cashCredit: 700, goldDebitGrams: 0, goldCreditGrams: 0 });
  });

  it('is a row the invoice sync leaves alone', async () => {
    const entry = await addHisaabEntry(db, form as never, 'Demo Customer', { now });
    const plan = planHisaabSync([], [entry], [{ id: 'cust-1', name: 'Demo Customer' }]);
    expect(plan).toEqual({ deletes: [], updates: [], creates: [] });
  });
});

describe('deleteHisaabEntry', () => {
  it('deletes the row and says whose it was', async () => {
    col('hisaab')['h1'] = { entityId: 'cust-1', description: 'Cash lent' };
    col('hisaab')['h2'] = { entityId: 'cust-1', description: 'Other' };
    expect(await deleteHisaabEntry(db, 'h1')).toEqual({ id: 'h1', entityId: 'cust-1', description: 'Cash lent' });
    expect(Object.keys(col('hisaab'))).toEqual(['h2']);
  });

  it('refuses a row that is not there', async () => {
    await expect(deleteHisaabEntry(db, 'h-nobody')).rejects.toThrow(HisaabRefusal);
    await expect(deleteHisaabEntry(db, 'h-nobody')).rejects.toThrow('No such ledger entry.');
  });
});
