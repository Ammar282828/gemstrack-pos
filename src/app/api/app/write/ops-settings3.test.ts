import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind both the Admin SDK and the port. All names, numbers and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id: string) => ({ set: async (d: Record<string, unknown>, o?: { merge?: boolean }) => put(c, id, d, o?.merge) }),
    }),
  },
}));

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
  newId: () => 'n1',
  timestamp: (d) => d.toISOString(),
  serverTime: () => 'now',
};

const codeChecks: string[] = [];
let goldPkUp = true;
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/people', () => ({ personFor: () => 'Demo Owner' }));
vi.mock('@/lib/store-config', () => ({
  STORE_CONFIG: { name: 'Demo Jewellers', address: 'Shop 1, Demo Road', contact1Number: '0300 000 0000', defaultMetal: 'gold' },
}));
vi.mock('@/app/api/gold-rates/route', () => ({
  GET: async () => (goldPkUp
    ? Response.json({ goldRatePerGram24k: 40000, goldRatePerGram22k: 36700, goldRatePerGram21k: 35000, goldRatePerGram18k: 30000, source: 'gold.pk' })
    : Response.json({ error: 'down' }, { status: 502 })),
}));
// The house's delete code is "4321" here.
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { SETTINGS3_OPS, runSettings3Op } = await import('./ops-settings3');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});
const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runSettings3Op(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  codeChecks.length = 0;
  goldPkUp = true;
});

describe('who may', () => {
  it('owners only', () => {
    for (const roles of Object.values(SETTINGS3_OPS)) expect(roles).toEqual(['owner']);
  });
});

describe('saveWebsiteConfig', () => {
  it('saves the checked document and refuses a bad one', async () => {
    const config = {
      enabled: true, defaultPricing: { karat: '21k', wastagePercentage: 5, makingChargesPerGram: 1000, stoneChargesDefault: 0 },
      categoryPricing: {}, diamondPolicy: 'enquire', diamondChargesDefault: 0, palladiumKarat: '18k', deliveryCharge: 300, posCategoryId: 'cat-1',
    };
    expect((await run('saveWebsiteConfig', { config: { ...config, palladiumKarat: '9k' } }))?.status).toBe(400);
    const ok = await run('saveWebsiteConfig', { config });
    expect(ok?.status).toBe(200);
    expect(col('app_settings').website).toMatchObject({ ...config, currency: 'PKR' });
    await flush();
    expect(logged[0].slice(0, 2)).toEqual(['settings.website', 'Website selling turned on']);
  });
});

describe('restoreShopDefaults', () => {
  it('previews without writing, then writes the shop and the rates through setRates', async () => {
    const preview = await run('restoreShopDefaults', { preview: true });
    expect(preview?.body).toMatchObject({ preview: true, shop: { shopName: 'Demo Jewellers', shopAddress: 'Shop 1, Demo Road', shopContact: '03000000000' }, rates: { goldRatePerGram21k: 35000 } });
    expect(data.app_settings).toBeUndefined();

    col('app_settings').global = { shopName: 'Old', goldRatePerGram21k: 34000 };
    const out = await run('restoreShopDefaults', {});
    expect(out?.status).toBe(200);
    expect(col('app_settings').global).toMatchObject({ shopName: 'Demo Jewellers', goldRatePerGram21k: 35000, ratesUpdatedBy: 'Demo Owner' });
    await flush();
    expect(logged.map((l) => l[0])).toEqual(['settings.update', 'rates.update']);
    expect(logged[1][2]).toContain('Restore shop defaults (gold.pk)');
  });

  it('restores the shop alone when gold.pk does not answer', async () => {
    goldPkUp = false;
    const out = await run('restoreShopDefaults', {});
    expect(out?.body).toMatchObject({ rates: null, ratesMoved: [] });
    expect(col('app_settings').global).toEqual({ shopName: 'Demo Jewellers', shopAddress: 'Shop 1, Demo Road', shopContact: '03000000000' });
  });
});

describe('setCounters', () => {
  it('asks the delete code only when a number moves, and writes old → new', async () => {
    col('app_settings').global = { lastInvoiceNumber: 120, lastOrderNumber: 45 };
    expect((await run('setCounters', { counters: { lastInvoiceNumber: 120 } }))?.body).toMatchObject({ ok: true, moved: [] });
    expect(codeChecks).toEqual([]);

    expect((await run('setCounters', { counters: { lastInvoiceNumber: -1 }, deleteCode: '4321' }))?.status).toBe(400);
    expect((await run('setCounters', { counters: { lastInvoiceNumber: 200 }, deleteCode: '1' }))?.status).toBe(403);
    expect(col('app_settings').global.lastInvoiceNumber).toBe(120);

    const out = await run('setCounters', { counters: { lastInvoiceNumber: 200, lastRepairNumber: 9 }, deleteCode: '4321' });
    expect(out?.body).toMatchObject({ moved: ['lastInvoiceNumber', 'lastRepairNumber'] });
    expect(col('app_settings').global).toEqual({ lastInvoiceNumber: 200, lastOrderNumber: 45, lastRepairNumber: 9 });
    await flush();
    expect(logged).toEqual([['settings.counters', 'Document numbering changed', 'Invoice 120 → 200 · Repair 0 → 9 · by Demo Owner', 'counters']]);
  });
});
