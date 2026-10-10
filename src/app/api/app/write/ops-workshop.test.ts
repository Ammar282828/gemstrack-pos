import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind the port the handler writes through. All names, ids and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
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
  async queryEquals(c, field, value) { return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never); },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add(c, d) { ids += 1; const id = `${c}-${ids}`; put(c, id, d); return id; },
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
  newId(c) { ids += 1; return `${c}-${ids}`; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => REMOVE } }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { WORKSHOP_OPS, runWorkshopOp } = await import('./ops-workshop');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runWorkshopOp(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  logged = [];
  codeChecks.length = 0;
  put('karigars', 'k1', { name: 'Ustad Demo' });
});

describe('who may run the workshop operations', () => {
  it('owners only, as the pages are', () => {
    expect(Object.keys(WORKSHOP_OPS).sort()).toEqual([
      'addSilverEntry', 'addStockJob', 'deleteGivenItem', 'deletePayBatch', 'deleteSilverEntry', 'deleteStockJob', 'removeKarigar',
      'setInvoicePieceDone', 'setInvoicePieceGiven', 'setInvoicePieceKarigar', 'setStockJobGiven', 'setStockJobStatus', 'settlePayBatch',
      'startPayBatch', 'updateGivenItem', 'updateStockJobDetails',
    ]);
    expect(Object.values(WORKSHOP_OPS).every((r) => r.length === 1 && r[0] === 'owner')).toBe(true);
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runWorkshopOp('addExpense', {}, ctx())).toBeNull();
    expect(await runWorkshopOp('addGivenItem', {}, ctx())).toBeNull();
  });
});

describe('pay batches', () => {
  it('starts one, now, and refuses a second while one is open', async () => {
    const r = await run('startPayBatch', { karigarId: 'k1', label: ' October 2026 ', startDate: '1999-01-01T00:00:00.000Z' });
    expect(r?.status).toBe(200);
    const batch = (r?.body.batch as Record<string, unknown>);
    expect(batch).toMatchObject({ karigarId: 'k1', label: 'October 2026' });
    // The moment is the server's, not the phone's.
    expect(batch.startDate).not.toBe('1999-01-01T00:00:00.000Z');
    expect(await run('startPayBatch', { karigarId: 'k1', label: 'Again' })).toEqual({ status: 409, body: { error: 'Ustad Demo already has an open pay batch, "October 2026". Settle it first.' } });
  });

  it('refuses a body of the wrong shape', async () => {
    for (const body of [{ label: 'X' }, { karigarId: 'k1' }, { karigarId: 'k1', label: '  ' }, { karigarId: 'k1', label: 7 }, { karigarId: 'a/b', label: 'X' }, { karigarId: 'k1', label: 'x'.repeat(121) }]) {
      expect((await run('startPayBatch', body))?.status).toBe(400);
    }
    expect(data.karigar_batches).toBeUndefined();
  });

  it('settles with the total shown, carries over, and refuses a total that has moved', async () => {
    put('karigar_batches', 'b1', { karigarId: 'k1', label: 'September 2026', startDate: '2026-09-01T00:00:00.000Z' });
    put('expenses', 'e1', { karigarId: 'k1', batchId: 'b1', amount: 6_000, date: '2026-09-05T00:00:00.000Z' });
    expect(await run('settlePayBatch', { batchId: 'b1', expectedTotal: 5_000 })).toEqual({
      status: 409, body: { error: '"September 2026" has changed since: it now comes to PKR 6,000. Check it and settle again.' },
    });
    expect((await run('settlePayBatch', { batchId: 'b1', expectedTotal: '6000' }))?.status).toBe(400);
    const r = await run('settlePayBatch', { batchId: 'b1', expectedTotal: 6_000, carryOverLabel: 'October 2026' });
    expect(r?.status).toBe(200);
    expect(r?.body).toMatchObject({ ok: true, batchId: 'b1', totalPaid: 6_000, next: { label: 'October 2026', karigarId: 'k1' } });
    expect(col('karigar_batches').b1).toMatchObject({ totalPaid: 6_000 });
    expect(await run('settlePayBatch', { batchId: 'b1', expectedTotal: 6_000 })).toEqual({ status: 409, body: { error: '"September 2026" is settled already.' } });
  });

  it('deletes a batch only with the code, after saying one that is gone', async () => {
    put('karigar_batches', 'b1', { karigarId: 'k1', label: 'August', startDate: '2026-08-01T00:00:00.000Z', closedDate: '2026-08-31T00:00:00.000Z' });
    expect(await run('deletePayBatch', { batchId: 'nope', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'No such pay batch.' } });
    expect(codeChecks).toEqual([]);
    expect(await run('deletePayBatch', { batchId: 'b1', deleteCode: '1111' })).toEqual({ status: 403, body: { error: 'Wrong code.' } });
    expect(col('karigar_batches').b1).toBeDefined();
    const r = await run('deletePayBatch', { batchId: 'b1', deleteCode: '4321' });
    expect(r?.body).toMatchObject({ ok: true, batchId: 'b1', payments: 0 });
    expect(codeChecks).toEqual(['Delete this karigar batch', 'Delete this karigar batch']);
    expect(col('karigar_batches').b1).toBeUndefined();
  });
});

describe('silver', () => {
  it('records an entry, a missing surcharge being none', async () => {
    const r = await run('addSilverEntry', { karigarId: 'k1', silverGrams: 50.5, description: 'March batch ring set' });
    expect(r?.status).toBe(200);
    expect(r?.body.entry).toMatchObject({ karigarId: 'k1', karigarName: 'Ustad Demo', silverGrams: 50.5, surchargePerGram: 0, totalSurcharge: 0, description: 'March batch ring set' });
  });

  it('refuses what the form refuses', async () => {
    expect(await run('addSilverEntry', { karigarId: 'k1', silverGrams: 0, surchargePerGram: 5 })).toEqual({ status: 409, body: { error: 'Silver grams must be greater than 0' } });
    expect((await run('addSilverEntry', { karigarId: 'k1', silverGrams: '5', surchargePerGram: 5 }))?.status).toBe(400);
    expect((await run('addSilverEntry', { silverGrams: 5 }))?.status).toBe(400);
    expect(data.silver_transactions).toBeUndefined();
  });

  it('deletes an entry with the code', async () => {
    put('silver_transactions', 's1', { karigarId: 'k1', silverGrams: 3, totalSurcharge: 30 });
    expect((await run('deleteSilverEntry', { id: 's1' }))?.body).toEqual({ error: 'Wrong code.' });
    expect((await run('deleteSilverEntry', { id: 's1', deleteCode: '4321' }))?.status).toBe(200);
    expect(codeChecks.at(-1)).toBe('Delete this silver entry');
    expect(col('silver_transactions').s1).toBeUndefined();
  });
});

describe('removing a karigar', () => {
  it('asks for the code in the store\'s words and hides him', async () => {
    expect((await run('removeKarigar', { karigarId: 'k1', deleteCode: '0000' }))?.status).toBe(403);
    expect(col('karigars').k1.deletedAt).toBeUndefined();
    const r = await run('removeKarigar', { karigarId: 'k1', deleteCode: '4321' });
    expect(r?.body).toMatchObject({ ok: true, karigarId: 'k1', name: 'Ustad Demo' });
    expect(codeChecks).toEqual(['Delete karigar Ustad Demo', 'Delete karigar Ustad Demo']);
    expect(typeof col('karigars').k1.deletedAt).toBe('string');
    expect(await run('removeKarigar', { karigarId: 'k1', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'No such karigar.' } });
  });
});

describe('stock work', () => {
  it('assigns a job with the form\'s fields, gold when no metal is named', async () => {
    const r = await run('addStockJob', { job: { karigarId: 'k1', description: 'Moti set repair', itemCategory: 'cat007', weightG: 12.25, quantity: 1, agreedCost: 2_000, size: '2.4', notes: 'Keep the clasp', status: 'completed', karigarName: 'Someone else' } });
    expect(r?.status).toBe(200);
    expect(r?.body.job).toMatchObject({ karigarId: 'k1', karigarName: 'Ustad Demo', description: 'Moti set repair', status: 'pending', itemCategory: 'cat007', metalType: 'gold', weightG: 12.25, quantity: 1, agreedCost: 2_000, size: '2.4', notes: 'Keep the clasp' });
  });

  it('refuses a job of the wrong shape and writes nothing', async () => {
    const ok = { karigarId: 'k1', description: 'Ring' };
    for (const patch of [
      { karigarId: '' }, { description: '  ' }, { itemCategory: 'rings' }, { metalType: 'brass' }, { weightG: -1 }, { weightG: '4' },
      { quantity: Number.NaN }, { agreedCost: -5 }, { size: 12 }, { notes: 'x'.repeat(2001) },
    ]) {
      expect((await run('addStockJob', { job: { ...ok, ...patch } }))?.status).toBe(400);
    }
    expect((await run('addStockJob', {}))?.status).toBe(400);
    expect(data.karigar_jobs).toBeUndefined();
  });

  describe('a job on file', () => {
    beforeEach(() => put('karigar_jobs', 'j1', { karigarId: 'k1', karigarName: 'Ustad Demo', description: 'Ring', status: 'pending', assignedDate: '2026-10-01T00:00:00.000Z', size: '7' }));

    it('sets a status the list knows, and refuses any other', async () => {
      expect((await run('setStockJobStatus', { jobId: 'j1', status: 'in-progress' }))?.status).toBe(200);
      expect(col('karigar_jobs').j1.status).toBe('in-progress');
      expect((await run('setStockJobStatus', { jobId: 'j1', status: 'Completed' }))?.status).toBe(400);
      expect(await run('setStockJobStatus', { jobId: 'nope', status: 'completed' })).toEqual({ status: 409, body: { error: 'No such job.' } });
    });

    it('ticks given at the moment sent, else now, and unticks', async () => {
      await run('setStockJobGiven', { jobId: 'j1', given: true, givenAt: '2026-10-08T07:30:00.000Z' });
      expect(col('karigar_jobs').j1.givenAt).toBe('2026-10-08T07:30:00.000Z');
      await run('setStockJobGiven', { jobId: 'j1', given: false });
      expect(col('karigar_jobs').j1).not.toHaveProperty('givenAt');
      await run('setStockJobGiven', { jobId: 'j1', given: true, givenAt: 'whenever' });
      expect(typeof col('karigar_jobs').j1.givenAt).toBe('string');
      expect((await run('setStockJobGiven', { jobId: 'j1', given: 'yes' }))?.status).toBe(400);
    });

    it('changes the making details, reading only those fields', async () => {
      const r = await run('updateStockJobDetails', { jobId: 'j1', patch: { description: 'Ring, resized', size: '', notes: 'Polish', weightG: 3.2, status: 'completed' } });
      expect(r?.body).toMatchObject({ ok: true, changed: ['description', 'size', 'notes', 'weightG'] });
      expect(col('karigar_jobs').j1).toMatchObject({ description: 'Ring, resized', notes: 'Polish', weightG: 3.2, status: 'pending' });
      expect(col('karigar_jobs').j1).not.toHaveProperty('size');
      for (const patch of [{ description: ' ' }, { weightG: -1 }, { weightG: null }, { size: 9 }]) {
        expect((await run('updateStockJobDetails', { jobId: 'j1', patch }))?.status).toBe(400);
      }
      expect(await run('updateStockJobDetails', { jobId: 'j1', patch: {} })).toEqual({ status: 409, body: { error: 'Nothing to change.' } });
    });

    it('deletes it with the code', async () => {
      expect((await run('deleteStockJob', { jobId: 'j1', deleteCode: '' }))?.status).toBe(403);
      expect((await run('deleteStockJob', { jobId: 'j1', deleteCode: '4321' }))?.body).toMatchObject({ ok: true, jobId: 'j1', description: 'Ring' });
      expect(codeChecks.at(-1)).toBe('Delete this karigar job');
      expect(col('karigar_jobs').j1).toBeUndefined();
    });
  });
});

describe('a sold piece on the bench', () => {
  beforeEach(() => put('invoices', 'INV-000001', { items: [{ name: 'Demo ring' }] }));

  it('assigns, ticks done and given, and refuses an index that is not a whole number', async () => {
    expect((await run('setInvoicePieceKarigar', { invoiceId: 'INV-000001', index: 0, karigarId: 'k1' }))?.status).toBe(200);
    expect((await run('setInvoicePieceGiven', { invoiceId: 'INV-000001', index: 0, given: true }))?.status).toBe(200);
    expect((await run('setInvoicePieceDone', { invoiceId: 'INV-000001', index: 0, done: true }))?.status).toBe(200);
    expect((col('invoices')['INV-000001'].items as Record<string, unknown>[])[0]).toMatchObject({ karigarId: 'k1', isCompleted: true });
    expect((await run('setInvoicePieceKarigar', { invoiceId: 'INV-000001', index: 0, karigarId: null }))?.status).toBe(200);
    expect((col('invoices')['INV-000001'].items as Record<string, unknown>[])[0]).not.toHaveProperty('karigarId');
    for (const body of [{ invoiceId: 'INV-000001', index: '0', done: true }, { invoiceId: 'INV-000001', index: 0.5, done: true }, { invoiceId: 'INV-000001', index: 0 }]) {
      expect((await run('setInvoicePieceDone', body))?.status).toBe(400);
    }
    expect(await run('setInvoicePieceDone', { invoiceId: 'INV-000001', index: 3, done: true })).toEqual({ status: 409, body: { error: 'That piece is not on this invoice any more.' } });
  });
});

describe('given items', () => {
  beforeEach(() => put('given_items', 'g1', { date: '2026-10-01T00:00:00.000Z', description: 'Ring sample', recipientType: 'karigar', recipientName: 'Ustad Demo', recipientId: 'k1', notes: '', status: 'out' }));

  it('edits an entry, an "other" recipient never linked', async () => {
    const r = await run('updateGivenItem', { id: 'g1', item: { date: '2026-10-02T05:00:00.000Z', description: ' Bangle sample ', recipientType: 'other', recipientName: 'A neighbour', recipientId: 'k1', notes: '', status: 'returned' } });
    expect(r?.status).toBe(200);
    expect(col('given_items').g1).toEqual({ date: '2026-10-02T05:00:00.000Z', description: 'Bangle sample', recipientType: 'other', recipientName: 'A neighbour', notes: '', status: 'out' });
  });

  it('sets, keeps and clears who gave it, and only to one of the shop\'s people', async () => {
    const base = { date: '2026-10-01T00:00:00.000Z', description: 'Ring sample', recipientType: 'karigar', recipientName: 'Ustad Demo', recipientId: 'k1', notes: '' };
    expect((await run('updateGivenItem', { id: 'g1', item: { ...base, givenBy: 'Ammar' } }))?.status).toBe(200);
    expect(col('given_items').g1.givenBy).toBe('Ammar');
    // An app that never sends the field leaves it as it was.
    expect((await run('updateGivenItem', { id: 'g1', item: base }))?.status).toBe(200);
    expect(col('given_items').g1.givenBy).toBe('Ammar');
    expect((await run('updateGivenItem', { id: 'g1', item: { ...base, givenBy: 'Bob' } }))?.status).toBe(400);
    expect((await run('updateGivenItem', { id: 'g1', item: { ...base, givenBy: null } }))?.status).toBe(200);
    expect(col('given_items').g1).not.toHaveProperty('givenBy');
  });

  it('refuses an edit of the wrong shape', async () => {
    const ok = { date: '2026-10-02T05:00:00.000Z', description: 'x', recipientType: 'karigar', recipientName: 'y', notes: '' };
    for (const patch of [{ date: 'soon' }, { description: '' }, { recipientType: 'friend' }, { recipientName: ' ' }, { notes: 5 }]) {
      expect((await run('updateGivenItem', { id: 'g1', item: { ...ok, ...patch } }))?.status).toBe(400);
    }
    expect(await run('updateGivenItem', { id: 'gone', item: ok })).toEqual({ status: 409, body: { error: 'No such given item.' } });
    expect(col('given_items').g1.description).toBe('Ring sample');
  });

  it('deletes an entry with the code, in the store\'s words', async () => {
    expect((await run('deleteGivenItem', { id: 'g1', deleteCode: '4321' }))?.status).toBe(200);
    expect(codeChecks).toEqual(['Delete given item "Ring sample"']);
    expect(col('given_items').g1).toBeUndefined();
    expect(await run('deleteGivenItem', { id: 'g1', deleteCode: '4321' })).toEqual({ status: 409, body: { error: 'No such given item.' } });
  });
});
