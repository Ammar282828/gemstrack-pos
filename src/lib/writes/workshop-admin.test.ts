import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import {
  addSilverEntry, addStockJob, deleteGivenItem, deletePayBatch, deleteSilverEntry, deleteStockJob, removeKarigar,
  setInvoicePieceDone, setInvoicePieceGiven, setInvoicePieceKarigar, setStockJobGiven, setStockJobStatus, settlePayBatch,
  startPayBatch, updateGivenItem, updateStockJobDetails, WorkshopRefusal,
} from './workshop-admin';

// One in-memory database behind the port. All names, ids and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
let commits = 0;
const REMOVE = '<field removed>';
const deps = { deleteField: () => REMOVE };
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
    if (writes.length) commits += 1;
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
      async commit() { writes.forEach((w) => w()); commits += 1; },
    };
  },
  newId(c) { ids += 1; return `${c}-${ids}`; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};

let logged: string[][] = [];
const fx = { log: (a: string, t: string, d: string, ref?: string) => { logged.push([a, t, d, ref ?? '']); } };
const NOW = '2026-10-09T08:00:00.000Z';

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  commits = 0;
  logged = [];
  put('karigars', 'k1', { name: 'Ustad Demo' });
  put('karigars', 'k-gone', { name: 'Removed Karigar', deletedAt: '2026-09-01T00:00:00.000Z' });
});

const refusedWith = async (p: Promise<unknown>, words: RegExp) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(WorkshopRefusal);
  expect((e as Error).message).toMatch(words);
};

describe('pay batches', () => {
  it('starts one as the page does: named, now, under his id, and logs it', async () => {
    const b = await startPayBatch(port, { karigarId: 'k1', label: '  October 2026 ', startDate: NOW }, fx);
    expect(b).toEqual({ id: 'karigar_batches-1', karigarId: 'k1', label: 'October 2026', startDate: NOW });
    expect(col('karigar_batches')['karigar_batches-1']).toEqual({ karigarId: 'k1', label: 'October 2026', startDate: NOW });
    expect(logged).toEqual([['karigar.update', 'Pay batch started: October 2026', 'Karigar: Ustad Demo', 'k1']]);
  });

  it('refuses a second open batch, a blank name and a karigar not on the books', async () => {
    put('karigar_batches', 'b1', { karigarId: 'k1', label: 'September 2026', startDate: '2026-09-01T00:00:00.000Z' });
    await refusedWith(startPayBatch(port, { karigarId: 'k1', label: 'October', startDate: NOW }), /already has an open pay batch, "September 2026"/);
    await refusedWith(startPayBatch(port, { karigarId: 'k1', label: '   ', startDate: NOW }), /Give the pay batch a name/);
    await refusedWith(startPayBatch(port, { karigarId: 'k-gone', label: 'X', startDate: NOW }), /No such karigar/);
    await refusedWith(startPayBatch(port, { karigarId: 'nobody', label: 'X', startDate: NOW }), /No such karigar/);
    expect(Object.keys(col('karigar_batches'))).toEqual(['b1']);
  });

  it('a settled batch is no bar to the next', async () => {
    put('karigar_batches', 'b1', { karigarId: 'k1', label: 'September 2026', startDate: '2026-09-01T00:00:00.000Z', closedDate: '2026-09-30T00:00:00.000Z' });
    expect((await startPayBatch(port, { karigarId: 'k1', label: 'October', startDate: NOW })).label).toBe('October');
  });

  describe('settling', () => {
    beforeEach(() => {
      put('karigar_batches', 'b1', { karigarId: 'k1', label: 'September 2026', startDate: '2026-09-01T00:00:00.000Z' });
      put('expenses', 'e1', { karigarId: 'k1', batchId: 'b1', amount: 4_000, date: '2026-09-05T00:00:00.000Z' });
      put('expenses', 'e2', { karigarId: 'k1', batchId: 'b1', amount: 2_500, date: '2026-09-15T00:00:00.000Z' });
      put('expenses', 'e3', { karigarId: 'k2', batchId: 'b1', amount: 999, date: '2026-09-15T00:00:00.000Z' });
      put('expenses', 'e4', { karigarId: 'k1', amount: 700, date: '2026-09-16T00:00:00.000Z' });
    });

    it('closes it now with the total its payments come to', async () => {
      const out = await settlePayBatch(port, { batchId: 'b1', closedDate: NOW, expectedTotal: 6_500 }, fx);
      expect(out).toEqual({ batchId: 'b1', label: 'September 2026', karigarId: 'k1', totalPaid: 6_500, closedDate: NOW, next: null });
      expect(col('karigar_batches').b1).toEqual({ karigarId: 'k1', label: 'September 2026', startDate: '2026-09-01T00:00:00.000Z', closedDate: NOW, totalPaid: 6_500 });
      expect(logged).toEqual([['karigar.update', 'Pay batch settled: September 2026', 'PKR 6,500', 'k1']]);
    });

    it('carries over to a new batch started at the same moment, in one commit', async () => {
      const out = await settlePayBatch(port, { batchId: 'b1', closedDate: NOW, expectedTotal: 6_500, carryOverLabel: ' October 2026 ' }, fx);
      expect(out.next).toEqual({ id: 'karigar_batches-1', karigarId: 'k1', label: 'October 2026', startDate: NOW });
      expect(col('karigar_batches')['karigar_batches-1']).toEqual({ karigarId: 'k1', label: 'October 2026', startDate: NOW });
      expect(commits).toBe(1);
      expect(logged[0][2]).toBe('PKR 6,500 | Carried over to: October 2026');
    });

    it('refuses when the payments no longer come to what the owner was shown', async () => {
      await refusedWith(settlePayBatch(port, { batchId: 'b1', closedDate: NOW, expectedTotal: 4_000 }), /has changed since: it now comes to PKR 6,500/);
      expect(col('karigar_batches').b1.closedDate).toBeUndefined();
    });

    it('settles without a figure to check, and refuses one already settled or gone', async () => {
      expect((await settlePayBatch(port, { batchId: 'b1', closedDate: NOW })).totalPaid).toBe(6_500);
      await refusedWith(settlePayBatch(port, { batchId: 'b1', closedDate: NOW }), /settled already/);
      await refusedWith(settlePayBatch(port, { batchId: 'nope', closedDate: NOW }), /No such pay batch/);
    });

    it('deletes the batch record only: its payments stay in Expenses, still filed under its id', async () => {
      const out = await deletePayBatch(port, { batchId: 'b1' }, fx);
      expect(out).toEqual({ batchId: 'b1', label: 'September 2026', karigarId: 'k1', payments: 2 });
      expect(col('karigar_batches').b1).toBeUndefined();
      // Its payments stay, unassigned: direct payments now, not lost to a batch that is gone.
      expect(col('expenses').e1).toMatchObject({ batchId: null, amount: 4_000 });
      expect(logged).toEqual([['karigar.update', 'Pay batch deleted: September 2026', '2 payments left in Expenses, unassigned', 'k1']]);
      await refusedWith(deletePayBatch(port, { batchId: 'b1' }), /No such pay batch/);
    });
  });
});

describe('silver', () => {
  it('records silver received at the surcharge per gram, under his name', async () => {
    const e = await addSilverEntry(port, { karigarId: 'k1', date: NOW, silverGrams: 12.5, surchargePerGram: 35, description: '  Ring set  ' }, fx);
    expect(e).toEqual({ id: 'silver_transactions-1', karigarId: 'k1', karigarName: 'Ustad Demo', date: NOW, silverGrams: 12.5, surchargePerGram: 35, totalSurcharge: 437.5, description: 'Ring set' });
    expect(col('silver_transactions')['silver_transactions-1']).not.toHaveProperty('id');
    expect(logged).toEqual([['karigar.update', 'Silver received: 12.500g', 'Karigar: Ustad Demo | Surcharge: PKR 438', 'k1']]);
  });

  it('leaves a blank note out, and refuses what the form refuses', async () => {
    const e = await addSilverEntry(port, { karigarId: 'k1', date: NOW, silverGrams: 2, surchargePerGram: 0, description: '  ' });
    expect(e).not.toHaveProperty('description');
    expect(e.totalSurcharge).toBe(0);
    await refusedWith(addSilverEntry(port, { karigarId: 'k1', date: NOW, silverGrams: 0, surchargePerGram: 5 }), /Silver grams must be greater than 0/);
    await refusedWith(addSilverEntry(port, { karigarId: 'k1', date: NOW, silverGrams: 1, surchargePerGram: -5 }), /Surcharge must be non-negative/);
    await refusedWith(addSilverEntry(port, { karigarId: 'k-gone', date: NOW, silverGrams: 1, surchargePerGram: 5 }), /No such karigar/);
    expect(Object.keys(col('silver_transactions'))).toHaveLength(1);
  });

  it('deletes an entry', async () => {
    put('silver_transactions', 's1', { karigarId: 'k1', karigarName: 'Ustad Demo', silverGrams: 3, surchargePerGram: 10, totalSurcharge: 30 });
    expect(await deleteSilverEntry(port, { id: 's1' }, fx)).toEqual({ id: 's1' });
    expect(col('silver_transactions').s1).toBeUndefined();
    expect(logged[0].slice(0, 3)).toEqual(['karigar.update', 'Silver entry deleted: 3.000g', 'Karigar: Ustad Demo']);
    await refusedWith(deleteSilverEntry(port, { id: 's1' }), /No such silver entry/);
  });
});

describe('removing a karigar', () => {
  it('hides him, and refuses one already removed', async () => {
    expect(await removeKarigar(port, { karigarId: 'k1', at: NOW }, fx)).toEqual({ karigarId: 'k1', name: 'Ustad Demo' });
    expect(col('karigars').k1).toEqual({ name: 'Ustad Demo', deletedAt: NOW });
    expect(logged).toEqual([['karigar.delete', 'Removed karigar: Ustad Demo', 'ID: k1', 'k1']]);
    await refusedWith(removeKarigar(port, { karigarId: 'k1', at: NOW }), /No such karigar/);
  });
});

describe('stock work', () => {
  it('assigns a job Pending from now, with only the fields given', async () => {
    const j = await addStockJob(port, {
      karigarId: 'k1', description: ' 4 stacked rings ', assignedDate: NOW, itemCategory: 'cat001', metalType: 'gold',
      weightG: 8.5, quantity: 4, size: ' 12 ', agreedCost: 3_000, notes: '  ',
    }, fx);
    expect(j).toEqual({
      id: 'karigar_jobs-1', karigarId: 'k1', karigarName: 'Ustad Demo', description: '4 stacked rings', status: 'pending', assignedDate: NOW,
      itemCategory: 'cat001', metalType: 'gold', weightG: 8.5, quantity: 4, size: '12', agreedCost: 3_000,
    });
    expect(logged).toEqual([['job.create', 'Assigned job to Ustad Demo', '4 stacked rings', 'karigar_jobs-1']]);
    await refusedWith(addStockJob(port, { karigarId: 'k1', description: ' ', assignedDate: NOW }), /describe the work/);
    await refusedWith(addStockJob(port, { karigarId: 'k-gone', description: 'x', assignedDate: NOW }), /No such karigar/);
  });

  describe('a job on file', () => {
    beforeEach(() => {
      put('karigar_jobs', 'j1', { karigarId: 'k1', karigarName: 'Ustad Demo', description: 'Moti set repair', status: 'pending', assignedDate: '2026-10-01T00:00:00.000Z', size: '7', notes: 'Old note' });
    });

    it('marks it completed with the moment, and back to pending keeping that stamp', async () => {
      await setStockJobStatus(port, { jobId: 'j1', status: 'completed', at: NOW }, fx);
      expect(col('karigar_jobs').j1).toMatchObject({ status: 'completed', completedDate: NOW });
      await setStockJobStatus(port, { jobId: 'j1', status: 'pending', at: '2026-10-10T00:00:00.000Z' }, fx);
      expect(col('karigar_jobs').j1).toMatchObject({ status: 'pending', completedDate: NOW });
      expect(logged.map(l => l[1])).toEqual(['Job marked completed', 'Job marked pending']);
      expect(logged[0][2]).toBe('Moti set repair — Ustad Demo');
      await refusedWith(setStockJobStatus(port, { jobId: 'gone', status: 'completed', at: NOW }), /No such job/);
      expect(col('karigar_jobs').gone).toBeUndefined();
    });

    it('ticks it given, and unticking removes the field', async () => {
      await setStockJobGiven(port, { jobId: 'j1', givenAt: NOW }, deps);
      expect(col('karigar_jobs').j1.givenAt).toBe(NOW);
      await setStockJobGiven(port, { jobId: 'j1', givenAt: null }, deps);
      expect(col('karigar_jobs').j1).not.toHaveProperty('givenAt');
      await refusedWith(setStockJobGiven(port, { jobId: 'gone', givenAt: NOW }, deps), /No such job/);
    });

    it('changes the making details: a blank size or instructions removed, a blank name kept', async () => {
      const out = await updateStockJobDetails(port, { jobId: 'j1', patch: { description: '  ', size: ' ', notes: ' Two stones ', weightG: 4.25 } }, deps, fx);
      expect(out.changed).toEqual(['size', 'notes', 'weightG']);
      expect(col('karigar_jobs').j1).toMatchObject({ description: 'Moti set repair', notes: 'Two stones', weightG: 4.25 });
      expect(col('karigar_jobs').j1).not.toHaveProperty('size');
      expect(logged).toEqual([['job.update', 'Updated workshop job', 'ID: j1', 'j1']]);
      await refusedWith(updateStockJobDetails(port, { jobId: 'j1', patch: {} }, deps), /Nothing to change/);
      await refusedWith(updateStockJobDetails(port, { jobId: 'gone', patch: { size: '9' } }, deps), /No such job/);
    });

    it('deletes it', async () => {
      expect(await deleteStockJob(port, { jobId: 'j1' }, fx)).toEqual({ jobId: 'j1', description: 'Moti set repair' });
      expect(col('karigar_jobs').j1).toBeUndefined();
      expect(logged).toEqual([['job.delete', 'Deleted workshop job: Moti set repair', 'Karigar: Ustad Demo', 'j1']]);
      await refusedWith(deleteStockJob(port, { jobId: 'j1' }), /No such job/);
    });
  });
});

describe('a sold piece on the bench', () => {
  beforeEach(() => {
    put('invoices', 'INV-000001', { grandTotal: 50_000, items: [{ sku: 'RIN-1', name: 'Demo ring', itemTotal: 50_000 }, { sku: 'BAN-1', name: 'Demo bangle', karigarId: 'k9' }] });
  });

  it('gives a piece to a karigar and takes him off again, touching nothing priced', async () => {
    await setInvoicePieceKarigar(port, { invoiceId: 'INV-000001', index: 0, karigarId: 'k1' }, fx);
    const items = () => col('invoices')['INV-000001'].items as Record<string, unknown>[];
    expect(items()[0]).toEqual({ sku: 'RIN-1', name: 'Demo ring', itemTotal: 50_000, karigarId: 'k1' });
    expect(col('invoices')['INV-000001'].grandTotal).toBe(50_000);
    expect(logged).toEqual([['invoice.update', 'Karigar assigned on INV-000001', 'Demo ring → Ustad Demo', 'INV-000001']]);
    await setInvoicePieceKarigar(port, { invoiceId: 'INV-000001', index: 0, karigarId: 'none' }, fx);
    expect(items()[0]).not.toHaveProperty('karigarId');
    expect(logged[1][2]).toBe('Demo ring → Unassigned');
    await refusedWith(setInvoicePieceKarigar(port, { invoiceId: 'INV-000001', index: 0, karigarId: 'k-gone' }), /No such karigar/);
  });

  it('marks it done and given, and refuses a piece or an invoice that is not there', async () => {
    await setInvoicePieceDone(port, { invoiceId: 'INV-000001', index: 1, done: true });
    await setInvoicePieceGiven(port, { invoiceId: 'INV-000001', index: 1, givenAt: NOW });
    const items = () => col('invoices')['INV-000001'].items as Record<string, unknown>[];
    expect(items()[1]).toMatchObject({ isCompleted: true, givenAt: NOW, karigarId: 'k9' });
    await setInvoicePieceGiven(port, { invoiceId: 'INV-000001', index: 1, givenAt: null });
    expect(items()[1]).not.toHaveProperty('givenAt');
    await refusedWith(setInvoicePieceDone(port, { invoiceId: 'INV-000001', index: 2, done: true }), /not on this invoice any more/);
    await refusedWith(setInvoicePieceDone(port, { invoiceId: 'INV-404', index: 0, done: true }), /No such invoice/);
  });

  it('writes a list kept as a map back as a list', async () => {
    put('invoices', 'INV-000002', { items: { 0: { name: 'A' }, 1: { name: 'B' } } });
    await setInvoicePieceDone(port, { invoiceId: 'INV-000002', index: 1, done: true });
    expect(col('invoices')['INV-000002'].items).toEqual([{ name: 'A' }, { name: 'B', isCompleted: true }]);
  });
});

describe('given items', () => {
  beforeEach(() => {
    put('given_items', 'g1', { date: '2026-10-01T00:00:00.000Z', description: 'Ring sample', recipientType: 'karigar', recipientName: 'Ustad Demo', recipientId: 'k1', notes: '', status: 'returned', returnedDate: '2026-10-05T00:00:00.000Z' });
  });

  it('edits an entry and leaves whether it came back as it was', async () => {
    await updateGivenItem(port, { id: 'g1', edit: { date: NOW, description: 'Bangle sample', recipientType: 'customer', recipientName: 'Demo Customer', recipientId: 'c1', notes: 'Try at home' } }, deps, fx);
    expect(col('given_items').g1).toEqual({
      date: NOW, description: 'Bangle sample', recipientType: 'customer', recipientName: 'Demo Customer', recipientId: 'c1', notes: 'Try at home',
      status: 'returned', returnedDate: '2026-10-05T00:00:00.000Z',
    });
    expect(logged).toEqual([['given.update', 'Updated given item', 'ID: g1', 'g1']]);
  });

  it('clears the old link when the name no longer resolves to one', async () => {
    await updateGivenItem(port, { id: 'g1', edit: { date: NOW, description: 'Ring sample', recipientType: 'other', recipientName: 'A neighbour', notes: '' } }, deps);
    expect(col('given_items').g1).not.toHaveProperty('recipientId');
    await refusedWith(updateGivenItem(port, { id: 'gone', edit: { date: NOW, description: 'x', recipientType: 'other', recipientName: 'y', notes: '' } }, deps), /No such given item/);
    expect(col('given_items').gone).toBeUndefined();
  });

  it('deletes an entry', async () => {
    expect(await deleteGivenItem(port, { id: 'g1' }, fx)).toEqual({ id: 'g1', description: 'Ring sample' });
    expect(col('given_items').g1).toBeUndefined();
    expect(logged).toEqual([['given.delete', 'Deleted given item: Ring sample', 'ID: g1', 'g1']]);
    await refusedWith(deleteGivenItem(port, { id: 'g1' }), /No such given item/);
  });
});
