import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { DEFAULT_OVERHEADS } from '@/lib/overheads';
import { cleanOverheadItems, overheadPlansFrom, plansAfterSave, saveOverheadPlan } from './overheads';

// An in-memory database behind the port, as people.test.ts has it. All names and amounts made up.
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
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
    newId() { return 'n1'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

const line = (id: string, label: string, amount: number) => ({ id, label, amount });

describe('which plans the sheet works from', () => {
  it('the saved plans, else the first-shape list from September, else the starting sheet', () => {
    const plans = [{ from: '2026-10', items: [line('a', 'Rent', 1)] }];
    expect(overheadPlansFrom({ overheadPlans: plans, monthlyOverheads: [line('b', 'Old', 2)] })).toEqual(plans);
    expect(overheadPlansFrom({ overheadPlans: [], monthlyOverheads: [line('b', 'Old', 2)] })).toEqual([{ from: '2026-09', items: [line('b', 'Old', 2)] }]);
    expect(overheadPlansFrom({})).toEqual([{ from: '2026-09', items: DEFAULT_OVERHEADS }]);
    expect(overheadPlansFrom(null)).toEqual([{ from: '2026-09', items: DEFAULT_OVERHEADS }]);
    // A field that is not a list is not a plan.
    expect(overheadPlansFrom({ overheadPlans: { 0: plans[0] } })).toEqual([{ from: '2026-09', items: DEFAULT_OVERHEADS }]);
  });
});

describe('saving the sheet', () => {
  it('drops blank lines and trims names; a named zero stays', () => {
    expect(cleanOverheadItems([line('a', '  Rent ', 20_000), line('b', '', 0), line('c', '   ', 0), line('d', 'Help', 0), line('e', '', 500)]))
      .toEqual([line('a', 'Rent', 20_000), line('d', 'Help', 0), line('e', '', 500)]);
  });

  it('from this month on: an earlier month keeps the plan it was scored against', () => {
    const plans = [{ from: '2026-09', items: [line('a', 'Rent', 1)] }, { from: '2026-10', items: [line('a', 'Rent', 2)] }];
    const { from, next } = plansAfterSave(plans, '2026-10', [line('a', 'Rent', 3)]);
    expect(from).toBe('2026-10');
    expect(next).toEqual([{ from: '2026-09', items: [line('a', 'Rent', 1)] }, { from: '2026-10', items: [line('a', 'Rent', 3)] }]);
    const later = plansAfterSave(plans, '2026-12', [line('a', 'Rent', 4)]);
    expect(later.next.map(p => p.from)).toEqual(['2026-09', '2026-10', '2026-12']);
    // Before the benchmark starts, a save is September's.
    expect(plansAfterSave([], '2026-07', []).from).toBe('2026-09');
  });

  it('writes only the plans, in Karachi\'s month, and says what it saved', async () => {
    const { db, data } = fakeDb({ app_settings: { global: { shopName: 'Demo Shop', overheadPlans: [{ from: '2026-09', items: [line('a', 'Rent', 10_000)] }] } } });
    const lines: string[][] = [];
    // 8 pm UTC on 30 September is already 1 October in Karachi.
    const out = await saveOverheadPlan(db, { items: [line('a', ' Rent ', 12_000), line('item-2', '', 0)], now: new Date('2026-09-30T20:00:00.000Z') },
      { log: (a, t, d) => { lines.push([a, t, d]); } });
    expect(out.from).toBe('2026-10');
    expect(out.items).toEqual([line('a', 'Rent', 12_000)]);
    expect(data.app_settings.global).toEqual({
      shopName: 'Demo Shop',
      overheadPlans: [{ from: '2026-09', items: [line('a', 'Rent', 10_000)] }, { from: '2026-10', items: [line('a', 'Rent', 12_000)] }],
    });
    expect(lines).toEqual([['settings.update', 'Overheads benchmark saved', 'PKR 12,000 a month, from October 2026']]);
  });

  it('a shop that never saved its sheet starts from the one it was shown', async () => {
    const { db, data } = fakeDb({});
    await saveOverheadPlan(db, { items: [line('x', 'Rent', 5_000)], now: new Date('2026-11-15T08:00:00.000Z') });
    expect(data.app_settings.global.overheadPlans).toEqual([
      { from: '2026-09', items: DEFAULT_OVERHEADS },
      { from: '2026-11', items: [line('x', 'Rent', 5_000)] },
    ]);
  });
});
