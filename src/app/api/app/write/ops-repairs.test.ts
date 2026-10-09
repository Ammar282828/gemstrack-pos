import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handler writes through. All names, phones and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const REMOVE = '<field removed>';
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
  const next: Record<string, unknown> = merge ? { ...col(c)[id], ...d } : { ...d };
  for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
  col(c)[id] = next;
};

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
  newId(c) { return `${c}-new`; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => REMOVE } }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { REPAIR_OPS, runRepairOp, repairEditFrom } = await import('./ops-repairs');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runRepairOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

const NOW = '2026-10-08T09:00:00.000Z';
const ticket = {
  customerName: 'Demo Repair', customerId: 'cust-demo', customerContact: '+923000000104',
  pieces: [{ item: 'Gold ring', work: 'resize to 14', price: 2_000 }],
  payments: [{ amount: 500, date: NOW, method: 'Cash', revenueId: 'rev-1', note: 'Advance' }],
  status: 'received', receivedAt: NOW, promisedDate: '2026-10-12', takenBy: 'Counter A',
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  codeChecks.length = 0;
});

describe('who may run the repair operations', () => {
  it('owners only, as every repair write is', () => {
    expect(REPAIR_OPS).toEqual({ updateRepair: ['owner'], deleteRepair: ['owner'] });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runRepairOp('addRepair', {}, ctx())).toBeNull();
  });
});

describe('updateRepair', () => {
  it('saves the form, names the karigar from the book, keeps the phone as the web does, and clears what was left empty', async () => {
    put('repairs', 'REP-000002', ticket);
    put('karigars', 'kar-demo', { name: 'Ustad Demo' });
    const r = await run('updateRepair', {
      repairId: 'REP-000002',
      repair: {
        customerName: ' Demo Repair ', customerContact: '0300 0000105',
        pieces: [{ item: ' Gold ring ', work: 'resize to 15', weightG: 4.5, price: 2_200 }, { item: '', work: '' }],
        karigarId: 'kar-demo', karigarName: 'Someone Else', promisedDate: '', takenBy: '', internalNote: ' wants it Friday ',
        // Not the form's: never read.
        status: 'collected', payments: [],
      },
    });
    expect(r?.status).toBe(200);
    expect(data.repairs['REP-000002']).toEqual({
      customerName: 'Demo Repair', customerContact: '+923000000105',
      pieces: [{ item: 'Gold ring', work: 'resize to 15', weightG: 4.5, price: 2_200 }],
      karigarId: 'kar-demo', karigarName: 'Ustad Demo', internalNote: 'wants it Friday',
      payments: ticket.payments, status: 'received', receivedAt: NOW,
    });
    expect((r?.body.repair as Record<string, unknown>).karigarName).toBe('Ustad Demo');
    expect(logged[0]).toEqual(['repair.update', 'Repair REP-000002 updated', 'Gold ring', 'REP-000002']);
  });

  it('refuses a ticket or karigar not on file', async () => {
    const piece = { pieces: [{ item: 'Ring', work: 'polish' }], customerName: '' };
    expect(await run('updateRepair', { repairId: 'REP-000009', repair: piece })).toEqual({ status: 409, body: { error: 'No such repair.' } });
    put('repairs', 'REP-000002', ticket);
    expect((await run('updateRepair', { repairId: 'REP-000002', repair: { ...piece, karigarId: 'kar-gone' } }))?.status).toBe(409);
    expect(data.repairs['REP-000002']).toEqual(ticket);
  });

  it('refuses a body of the wrong shape and writes nothing', async () => {
    put('repairs', 'REP-000002', ticket);
    for (const repair of [
      undefined, 'ring', { pieces: 'ring' }, { pieces: [] }, { pieces: [{ item: '', work: ' ' }] },
      { pieces: [null] }, { pieces: [{ item: 7 }] }, { pieces: [{ item: 'Ring', price: -1 }] }, { pieces: [{ item: 'Ring', weightG: '4' }] },
      { pieces: [{ item: 'Ring' }], promisedDate: '12 Oct' }, { pieces: [{ item: 'Ring' }], customerName: 5 },
      { pieces: [{ item: 'Ring' }], karigarId: 'a/b' }, { pieces: [{ item: 'Ring' }], customerId: 9 },
    ]) {
      expect((await run('updateRepair', { repairId: 'REP-000002', repair }))?.status).toBe(400);
    }
    expect((await run('updateRepair', { repair: { pieces: [{ item: 'Ring' }] } }))?.status).toBe(400);
    expect(data.repairs['REP-000002']).toEqual(ticket);
  });

  it('reads the form\'s fields as the web form keeps them', () => {
    const r = repairEditFrom({ customerName: '', pieces: [{ item: '', work: 'polish', price: 0 }], customerId: '' });
    expect(r).toEqual({ ok: true, value: { customerName: '', pieces: [{ item: 'Piece', work: 'polish' }] } });
  });
});

describe('deleteRepair', () => {
  it('asks for the code, then deletes the ticket and the money taken on it', async () => {
    put('repairs', 'REP-000002', ticket);
    put('additional_revenue', 'rev-1', { amount: 500, repairId: 'REP-000002' });
    put('additional_revenue', 'rev-2', { amount: 700, description: 'Commission' });
    expect(await run('deleteRepair', { repairId: 'REP-000002', deleteCode: '0000' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect(data.repairs['REP-000002']).toBeDefined();
    const r = await run('deleteRepair', { repairId: 'REP-000002', deleteCode: '4321' });
    expect(r).toEqual({ status: 200, body: { ok: true, repairId: 'REP-000002', revenueIds: ['rev-1'], followUps: [] } });
    expect(data.repairs).toEqual({});
    expect(Object.keys(data.additional_revenue)).toEqual(['rev-2']);
    expect(codeChecks).toEqual(['Delete repair REP-000002', 'Delete repair REP-000002']);
    expect(logged.map((l) => l[0])).toEqual(['repair.delete']);
  });

  it('says a ticket is gone before the code is asked for', async () => {
    expect(await run('deleteRepair', { repairId: 'REP-000009', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'No such repair.' } });
    expect(await run('deleteRepair', { deleteCode: '4321' })).toEqual({ status: 400, body: { error: 'Which repair?' } });
    expect(codeChecks).toEqual([]);
  });
});
