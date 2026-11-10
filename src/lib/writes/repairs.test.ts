import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { addRepair, recordRepairPayment, setRepairStatus } from './repairs';

function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  let ids = 0;
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
        async commit() { writes.forEach((w) => w()); },
      };
    },
    newId() { return `r${++ids}`; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

const NOW = '2026-10-08T09:00:00.000Z';
const ticket = { customerName: 'Demo Repair', pieces: [{ item: 'Gold ring', work: 'resize to 14', price: 2_000 }, { item: 'Chain', work: 'clasp', price: 800 }] };

describe('repair tickets', () => {
  it('numbers from the counter, never below the floor, and books an advance as extra revenue', async () => {
    const { db, data } = fakeDb({ app_settings: { global: { lastRepairNumber: 3 } } });
    const r = await addRepair(db, { ...ticket, advance: 1_000, advanceMethod: 'Cash' }, { floor: 7, now: NOW });
    expect(r.id).toBe('REP-000008');
    expect(r.status).toBe('received');
    expect(r.receivedAt).toBe(NOW);
    expect(data.app_settings.global.lastRepairNumber).toBe(8);
    expect(r.payments).toEqual([{ amount: 1_000, date: NOW, method: 'Cash', revenueId: 'r1', note: 'Advance' }]);
    expect(data.additional_revenue.r1).toEqual({ date: NOW, amount: 1_000, repairId: 'REP-000008', description: 'Repair REP-000008 — advance: Gold ring + 1 more (Demo Repair)' });
  });

  it('refuses a number already taken', async () => {
    const { db } = fakeDb({ app_settings: { global: { lastRepairNumber: 1 } }, repairs: { 'REP-000002': { customerName: 'x' } } });
    await expect(addRepair(db, ticket, { now: NOW })).rejects.toThrow(/already exists/);
  });

  it('stamps ready and collected, and takes the balance with its revenue row', async () => {
    const { db, data } = fakeDb({ repairs: { 'REP-000001': { ...ticket, payments: [], status: 'received' } } });
    await setRepairStatus(db, 'REP-000001', 'ready', { now: NOW });
    expect(data.repairs['REP-000001']).toMatchObject({ status: 'ready', readyAt: NOW, customerName: 'Demo Repair' });
    await recordRepairPayment(db, 'REP-000001', { amount: 2_800, date: NOW, method: 'Card' });
    expect(data.repairs['REP-000001'].payments).toEqual([{ amount: 2_800, date: NOW, method: 'Card', revenueId: 'r1' }]);
    expect(data.additional_revenue.r1).toMatchObject({ amount: 2_800, repairId: 'REP-000001' });
    await setRepairStatus(db, 'REP-000001', 'collected', { now: NOW });
    expect(data.repairs['REP-000001']).toMatchObject({ status: 'collected', collectedAt: NOW });
    // Nothing taken, nothing written.
    await recordRepairPayment(db, 'REP-000001', { amount: 0, date: NOW });
    expect(Object.keys(data.additional_revenue)).toEqual(['r1']);
  });
});

describe('repair status follows the repair machine', () => {
  const seedRepair = (extra: Record<string, unknown> = {}) => ({ repairs: { 'REP-000001': { ...ticket, payments: [], status: 'received', ...extra } } });

  it('is not collected with money owing: refused with the amount, nothing written', async () => {
    const { db, data } = fakeDb(seedRepair({ status: 'ready' }));
    await expect(setRepairStatus(db, 'REP-000001', 'collected', { now: NOW })).rejects.toMatchObject({ name: 'MoveRefused', status: 409, machine: 'Repair', message: expect.stringMatching(/2,800 is still owed/) });
    expect(data.repairs['REP-000001']).toMatchObject({ status: 'ready' });
    expect(data.repairs['REP-000001'].collectedAt).toBeUndefined();
  });

  it('collected with nothing owed works, straight from In the shop, and the hand-back order (payment, then status) sees the payment', async () => {
    const free = fakeDb({ repairs: { 'REP-000002': { customerName: 'x', pieces: [{ item: 'Ring', work: 'polish', price: 0 }], payments: [], status: 'received' } } });
    await setRepairStatus(free.db, 'REP-000002', 'collected', { now: NOW });
    expect(free.data.repairs['REP-000002']).toMatchObject({ status: 'collected', collectedAt: NOW });
    const { db, data } = fakeDb(seedRepair());
    await recordRepairPayment(db, 'REP-000001', { id: 'hb-1', amount: 2_800, date: NOW, method: 'Cash', note: 'On collection' });
    await setRepairStatus(db, 'REP-000001', 'collected', { now: NOW });
    expect(data.repairs['REP-000001']).toMatchObject({ status: 'collected' });
  });

  it('a retried hand-back with the same payment id takes the money once', async () => {
    const { db, data } = fakeDb(seedRepair());
    await recordRepairPayment(db, 'REP-000001', { id: 'hb-7', amount: 2_800, date: NOW });
    await recordRepairPayment(db, 'REP-000001', { id: 'hb-7', amount: 2_800, date: NOW });
    expect(data.repairs['REP-000001'].payments).toHaveLength(1);
    expect(Object.keys(data.additional_revenue)).toHaveLength(1);
  });

  it('undo and the other hand moves still work, and the same status writes nothing', async () => {
    const { db, data } = fakeDb(seedRepair({ status: 'collected', collectedAt: 'then', payments: [{ amount: 2_800, date: NOW }] }));
    await setRepairStatus(db, 'REP-000001', 'received', { now: NOW });
    expect(data.repairs['REP-000001'].status).toBe('received');
    await setRepairStatus(db, 'REP-000001', 'cancelled', { now: NOW });
    expect(data.repairs['REP-000001'].status).toBe('cancelled');
    await setRepairStatus(db, 'REP-000001', 'received', { now: NOW });
    await setRepairStatus(db, 'REP-000001', 'ready', { now: '2026-10-09T00:00:00.000Z' });
    await setRepairStatus(db, 'REP-000001', 'ready', { now: '2026-10-10T00:00:00.000Z' });
    expect(data.repairs['REP-000001'].readyAt).toBe('2026-10-09T00:00:00.000Z');
  });

  it('a repair that is not there is an error, not a document made by a merge', async () => {
    const { db, data } = fakeDb({});
    await expect(setRepairStatus(db, 'REP-000404', 'ready', { now: NOW })).rejects.toThrow('Repair REP-000404 not found.');
    expect(data.repairs?.['REP-000404']).toBeUndefined();
  });

  it('a cancelled ticket cannot be called ready except by putting it back in the shop first', async () => {
    const { db } = fakeDb(seedRepair({ status: 'cancelled' }));
    await expect(setRepairStatus(db, 'REP-000001', 'ready', { now: NOW })).rejects.toMatchObject({ machine: 'Repair', allowed: [{ to: 'received', event: 'set' }] });
  });
});

