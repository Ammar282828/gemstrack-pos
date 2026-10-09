import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { purgeRemoved, restoreRemoved } from './recently-removed';

// An in-memory database behind the port; the field-removal value is a marker the fake honours. All names made up.
const REMOVE = Symbol('remove');

function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  let commits = 0;
  const col = (c: string) => (data[c] ??= {});
  const apply = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
    const next: Record<string, unknown> = merge ? { ...col(c)[id], ...d } : { ...d };
    for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
    col(c)[id] = next;
  };
  const db: DbPort = {
    async runTransaction(fn) {
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { apply(c, id, d, merge); },
        update(c, id, d) { apply(c, id, d, true); },
        delete(c, id) { delete col(c)[id]; },
      };
      return fn(tx);
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
    newId() { return 'n1'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data, commits: () => commits };
}

const logger = () => {
  const lines: string[][] = [];
  return { lines, fx: { log: (a: string, t: string, d: string, id?: string) => { lines.push([a, t, d, id ?? '']); } } };
};

const seed = () => ({
  customers: {
    'cust-1': { name: 'Removed Customer', phone: '+923001110000', deletedAt: '2026-10-01T05:00:00.000Z' },
    'cust-2': { name: 'Live Customer' },
    'cust-3': { deletedAt: '2026-10-02T05:00:00.000Z' },
  },
  karigars: {
    'kar-1': { name: 'Removed Karigar', deletedAt: '2026-10-03T05:00:00.000Z' },
    'kar-2': { name: 'Live Karigar' },
  },
});

describe('putting people back', () => {
  it('clears the removal and keeps every other field; logs each as the store does', async () => {
    const { db, data } = fakeDb(seed());
    const { fx, lines } = logger();
    const out = await restoreRemoved(db, { customerIds: ['cust-1', 'cust-1', 'cust-3'], karigarIds: ['kar-1'] }, { deleteField: () => REMOVE }, fx);
    expect(out).toEqual({ customers: ['cust-1', 'cust-3'], karigars: ['kar-1'] });
    expect(data.customers['cust-1']).toEqual({ name: 'Removed Customer', phone: '+923001110000' });
    expect(data.karigars['kar-1']).toEqual({ name: 'Removed Karigar' });
    expect(lines).toEqual([
      ['customer.update', 'Restored customer: Removed Customer', 'ID: cust-1', 'cust-1'],
      ['customer.update', 'Restored customer: cust-3', 'ID: cust-3', 'cust-3'],
      ['karigar.update', 'Restored karigar: Removed Karigar', 'ID: kar-1', 'kar-1'],
    ]);
  });

  it('someone not removed, or not on file, is left alone', async () => {
    const { db, data } = fakeDb(seed());
    const { fx, lines } = logger();
    const out = await restoreRemoved(db, { customerIds: ['cust-2', 'cust-gone'], karigarIds: ['kar-2'] }, { deleteField: () => REMOVE }, fx);
    expect(out).toEqual({ customers: [], karigars: [] });
    expect(data).toEqual(seed());
    expect(lines).toEqual([]);
  });
});

describe('emptying the list', () => {
  it('deletes the removed people named, never a live one, and logs it once', async () => {
    const { db, data } = fakeDb(seed());
    const { fx, lines } = logger();
    const out = await purgeRemoved(db, { customerIds: ['cust-1', 'cust-2', 'cust-3'], karigarIds: ['kar-1', 'kar-2'] }, fx);
    expect(out).toEqual({ customers: 2, karigars: 1 });
    expect(Object.keys(data.customers)).toEqual(['cust-2']);
    expect(Object.keys(data.karigars)).toEqual(['kar-2']);
    expect(lines).toEqual([['customer.delete', 'Permanently deleted 2 customer(s) and 1 karigar(s)', 'Emptied Recently removed', 'recently-removed']]);
  });

  it('nothing removed: nothing deleted, nothing logged', async () => {
    const { db, data, commits } = fakeDb(seed());
    const { fx, lines } = logger();
    expect(await purgeRemoved(db, { customerIds: ['cust-2'], karigarIds: [] }, fx)).toEqual({ customers: 0, karigars: 0 });
    expect(data).toEqual(seed());
    expect(commits()).toBe(0);
    expect(lines).toEqual([]);
  });

  it('a long list goes in batches Firestore will take', async () => {
    const many: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 460; i++) many[`c${i}`] = { name: `Test ${i}`, deletedAt: '2026-10-01T05:00:00.000Z' };
    const { db, data, commits } = fakeDb({ customers: many });
    expect(await purgeRemoved(db, { customerIds: Object.keys(many), karigarIds: [] })).toEqual({ customers: 460, karigars: 0 });
    expect(data.customers).toEqual({});
    expect(commits()).toBe(2);
  });
});
