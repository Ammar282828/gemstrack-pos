import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { deleteRepair, repairPiecesFrom, updateRepair, type RepairEdit } from './repair-admin';

// An in-memory database behind the port. All names, phones and amounts made up.
const REMOVE = '<field removed>';
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
    newId() { return 'new-id'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data, commits: () => commits };
}

const deps = { deleteField: () => REMOVE };
const NOW = '2026-10-08T09:00:00.000Z';
const ticket = {
  id: 'REP-000004', customerName: 'Demo Repair', customerId: 'cust-demo', customerContact: '+923000000104',
  pieces: [{ item: 'Gold ring', work: 'resize to 14', weightG: 4.2, price: 2_000 }],
  payments: [{ amount: 1_000, date: NOW, method: 'Cash', revenueId: 'rev-1', note: 'Advance' }],
  status: 'ready', receivedAt: NOW, readyAt: NOW, promisedDate: '2026-10-12',
  karigarId: 'kar-demo', karigarName: 'Ustad Demo', takenBy: 'Counter A', internalNote: 'Scratched band',
};

describe('the form\'s pieces', () => {
  it('trims the words, keeps only weights and prices over 0, drops empty lines and names a work-only line "Piece"', () => {
    expect(repairPiecesFrom([
      { item: '  Chain ', work: ' clasp ', weightG: 0, price: 500 },
      { item: '', work: '' },
      { item: '', work: 'polish', weightG: 1.25 },
    ])).toEqual([
      { item: 'Chain', work: 'clasp', price: 500 },
      { item: 'Piece', work: 'polish', weightG: 1.25 },
    ]);
  });
});

describe('editing a ticket', () => {
  it('writes every field the form shows, removes the ones left empty, and keeps the money and the status', async () => {
    const { db, data } = fakeDb({ repairs: { 'REP-000004': ticket } });
    const logged: string[][] = [];
    const edit: RepairEdit = {
      customerName: 'Demo Repair Two',
      pieces: [{ item: 'Gold ring', work: 'resize to 15', price: 2_500 }, { item: 'Chain', work: 'clasp', price: 800 }],
      promisedDate: '2026-10-14',
    };
    const saved = await updateRepair(db, 'REP-000004', edit, deps, { log: (a, t, d, r) => { logged.push([a, t, d, r ?? '']); } });
    const onFile = data.repairs['REP-000004'];
    expect(onFile).toEqual({
      id: 'REP-000004', customerName: 'Demo Repair Two', pieces: edit.pieces, promisedDate: '2026-10-14',
      payments: ticket.payments, status: 'ready', receivedAt: NOW, readyAt: NOW,
    });
    // The customer, phone, karigar, taken by and note were left empty: gone, not kept.
    for (const k of ['customerId', 'customerContact', 'karigarId', 'karigarName', 'takenBy', 'internalNote']) expect(onFile).not.toHaveProperty(k);
    expect(saved).toEqual({ ...onFile });
    expect(logged).toEqual([['repair.update', 'Repair REP-000004 updated', 'Gold ring + 1 more', 'REP-000004']]);
  });

  it('refuses a ticket that is not on file, and one with no pieces, writing nothing', async () => {
    const { db, data } = fakeDb({});
    await expect(updateRepair(db, 'REP-000009', { customerName: '', pieces: [{ item: 'Ring', work: '' }] }, deps)).rejects.toThrow('No such repair.');
    await expect(updateRepair(db, 'REP-000009', { customerName: '', pieces: [] }, deps)).rejects.toThrow(/at least one piece/);
    expect(data.repairs ?? {}).toEqual({});
  });
});

describe('deleting a ticket', () => {
  it('takes every row of money taken on it out of Extra Revenue, in one commit, and leaves other rows alone', async () => {
    const { db, data, commits } = fakeDb({
      repairs: { 'REP-000004': ticket },
      additional_revenue: {
        'rev-1': { amount: 1_000, repairId: 'REP-000004', description: 'advance' },
        // A row that names the ticket though no payment points at it.
        'rev-2': { amount: 300, repairId: 'REP-000004', description: 'stray' },
        'rev-3': { amount: 900, repairId: 'REP-000005', description: 'another ticket' },
        'rev-4': { amount: 700, description: 'Commission' },
      },
    });
    const logged: string[][] = [];
    const out = await deleteRepair(db, 'REP-000004', { log: (a, t, d, r) => { logged.push([a, t, d, r ?? '']); } });
    expect(out).toEqual({ repairId: 'REP-000004', revenueIds: ['rev-1', 'rev-2'] });
    expect(data.repairs).toEqual({});
    expect(Object.keys(data.additional_revenue).sort()).toEqual(['rev-3', 'rev-4']);
    expect(commits()).toBe(1);
    expect(logged).toEqual([['repair.delete', 'Repair REP-000004 deleted', 'Gold ring — Demo Repair', 'REP-000004']]);
  });

  it('refuses a ticket already gone', async () => {
    const { db } = fakeDb({});
    await expect(deleteRepair(db, 'REP-000004')).rejects.toThrow('No such repair.');
  });
});
