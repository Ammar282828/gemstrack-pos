import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { cleanSettingsPatch } from './settings';
import { cleanCounters, countersLog, countersMoving, setCounters } from './counters';

// All numbers made up.
describe('cleanCounters', () => {
  it('keeps the three counters as whole numbers of 0 or more', () => {
    expect(cleanCounters({ lastInvoiceNumber: 120, lastOrderNumber: 0, lastRepairNumber: 7, shopName: 'x', databaseLocked: false }))
      .toEqual({ ok: true, counters: { lastInvoiceNumber: 120, lastOrderNumber: 0, lastRepairNumber: 7 } });
    expect(cleanCounters({ lastOrderNumber: 45 })).toEqual({ ok: true, counters: { lastOrderNumber: 45 } });
  });

  it('refuses anything else', () => {
    for (const v of [-1, 1.5, '12', Number.NaN, 1e12]) expect(cleanCounters({ lastInvoiceNumber: v }).ok, String(v)).toBe(false);
    expect(cleanCounters({}).ok).toBe(false);
    expect(cleanCounters(null).ok).toBe(false);
    expect(cleanCounters({ shopName: 'x' }).ok).toBe(false);
  });

  it('leaves updateSettings without the counters', () => {
    expect(cleanSettingsPatch({ lastInvoiceNumber: 5, lastOrderNumber: 5, lastRepairNumber: 5 })).toEqual({ ok: false, error: 'Nothing to save.' });
  });
});

describe('setCounters', () => {
  const dbWith = (held: Record<string, unknown>, sets: unknown[][]): DbPort => ({
    runTransaction: async (fn: (tx: TxCtx) => Promise<unknown>) => fn({
      get: async () => ({ ...held, id: 'global' }),
      set: (...a: unknown[]) => { sets.push(a); },
      update() {}, delete() {},
    } as TxCtx),
  }) as unknown as DbPort;

  it('writes only the counters that move and logs each old → new', async () => {
    const sets: unknown[][] = [];
    const logs: string[][] = [];
    const db = dbWith({ lastInvoiceNumber: 120, lastOrderNumber: 45 }, sets);
    const out = await setCounters(db, { lastInvoiceNumber: 200, lastOrderNumber: 45, lastRepairNumber: 10 }, { by: 'Demo Owner' },
      { log: (a, t, d, r) => { logs.push([a, t, d, r ?? '']); } });
    expect(out).toEqual({ moved: ['lastInvoiceNumber', 'lastRepairNumber'], before: { lastInvoiceNumber: 120, lastRepairNumber: 0 }, after: { lastInvoiceNumber: 200, lastRepairNumber: 10 } });
    expect(sets).toEqual([['app_settings', 'global', { lastInvoiceNumber: 200, lastRepairNumber: 10 }, true]]);
    expect(logs).toEqual([['settings.counters', 'Document numbering changed', 'Invoice 120 → 200 · Repair 0 → 10 · by Demo Owner', 'counters']]);
  });

  it('writes and logs nothing when nothing moves', async () => {
    const sets: unknown[][] = [];
    const logs: string[] = [];
    const out = await setCounters(dbWith({ lastInvoiceNumber: 120 }, sets), { lastInvoiceNumber: 120 }, { by: 'x' }, { log: (a) => { logs.push(a); } });
    expect(out.moved).toEqual([]);
    expect(sets).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('holds to the owner\'s lock', async () => {
    await expect(setCounters(dbWith({ databaseLocked: true }, []), { lastOrderNumber: 1 }, { by: 'x' })).rejects.toThrow(/locked/);
  });

  it('reads a missing counter as 0', () => {
    expect(countersMoving(null, { lastOrderNumber: 0 })).toEqual([]);
    expect(countersLog(['lastOrderNumber'], null, { lastOrderNumber: 3 })).toBe('Order 0 → 3');
  });
});
