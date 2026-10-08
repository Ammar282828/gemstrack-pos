import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { orderStatusPatch, pieceDonePatch, pieceGivenPatch, pieceKarigarPatch, setOrderPieceDone, setOrderPieceGiven, setOrderPieceKarigar, setOrderStatus } from './order-status';
import { recordOrderAdvance } from './order-advance';
import { cleanRates, setRates } from './rates';
import { addExpense } from './expenses';

/** An in-memory database with Firestore's merge, for the order writes. */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  const db: DbPort = {
    async runTransaction(fn) {
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      return out;
    },
    async queryEquals() { return []; },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { col(c)[id] = { ...col(c)[id], ...d }; },
    batch() {
      const writes: (() => void)[] = [];
      return {
        set(c, id, d, merge) { writes.push(() => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
        async commit() { writes.forEach(w => w()); },
      };
    },
    newId() { return 'n'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

const pieces = (...done: boolean[]) => done.map((d, i) => ({ description: `Piece ${i + 1}`, isCompleted: d, karigarId: 'k1' }));

describe('order status', () => {
  it('completing an order ticks every piece, and says how many', () => {
    const { patch, ticked } = orderStatusPatch({ status: 'In Progress', items: pieces(true, false, false) }, 'Completed');
    expect(ticked).toBe(2);
    expect((patch.items as { isCompleted: boolean }[]).every(i => i.isCompleted)).toBe(true);
  });

  it('any other status leaves the pieces alone', () => {
    expect(orderStatusPatch({ status: 'Pending', items: pieces(false) }, 'Cancelled')).toEqual({ patch: { status: 'Cancelled' }, ticked: 0 });
  });

  it('the last piece ticked finishes the order; unticking one sends it back', () => {
    expect(pieceDonePatch({ status: 'In Progress', items: pieces(true, false) }, 1, true).nextStatus).toBe('Completed');
    expect(pieceDonePatch({ status: 'Completed', items: pieces(true, true) }, 0, false).nextStatus).toBe('In Progress');
    // An invoiced order is never moved by its pieces.
    expect(pieceDonePatch({ status: 'In Progress', items: pieces(true, false), invoiceId: 'INV-1' }, 1, true).nextStatus).toBeNull();
  });

  it('runs on the server the same way, alerting only for a finished, cancelled or refunded order', async () => {
    const { db, data } = fakeDb({ orders: { 'ORD-1': { status: 'In Progress', items: pieces(false, false), customerName: 'Demo' } } });
    const alerted: string[] = [];
    await setOrderStatus(db, { orderId: 'ORD-1', status: 'Completed' }, { notify: id => alerted.push(id) });
    expect(data.orders['ORD-1']).toMatchObject({ status: 'Completed', customerName: 'Demo' });
    expect((data.orders['ORD-1'].items as { isCompleted: boolean }[]).every(i => i.isCompleted)).toBe(true);
    expect(alerted).toEqual(['ORD-1']);

    await setOrderStatus(db, { orderId: 'ORD-1', status: 'In Progress' }, { notify: id => alerted.push(id) });
    expect(alerted).toEqual(['ORD-1']);
  });

  it('a piece that is no longer there is refused, not written', async () => {
    const { db, data } = fakeDb({ orders: { 'ORD-2': { status: 'Pending', items: pieces(false) } } });
    await expect(setOrderPieceDone(db, { orderId: 'ORD-2', index: 3, done: true })).rejects.toThrow(/not on this order/);
    expect(data.orders['ORD-2'].status).toBe('Pending');
    const out = await setOrderPieceDone(db, { orderId: 'ORD-2', index: 0, done: true });
    expect(out.status).toBe('Completed');
  });
});

describe('order advance', () => {
  it('adds the advance, keeps its day and method, and takes the discount into the balance', async () => {
    const { db, data } = fakeDb({ orders: { 'ORD-3': { subtotal: 100_000, discountAmount: 5_000, advancePayment: 10_000, advances: [], advanceInExchangeValue: 2_000 } } });
    const out = await recordOrderAdvance(db, { orderId: 'ORD-3', amount: 20_000, method: 'Cash', notes: ' second ', date: '2026-10-08T10:00:00.000Z' });
    expect(out.grandTotal).toBe(100_000 - 5_000 - 30_000 - 2_000);
    expect(data.orders['ORD-3']).toMatchObject({ advancePayment: 30_000, grandTotal: 63_000 });
    expect(data.orders['ORD-3'].advances).toEqual([{ amount: 20_000, date: '2026-10-08T10:00:00.000Z', notes: 'second', method: 'Cash' }]);
  });

  it('is refused once the order is invoiced', async () => {
    const { db } = fakeDb({ orders: { 'ORD-4': { subtotal: 1, invoiceId: 'INV-9' } } });
    await expect(recordOrderAdvance(db, { orderId: 'ORD-4', amount: 1 })).rejects.toThrow(/take the payment on the invoice/);
  });
});

describe('setting the rates', () => {
  const now = new Date('2026-10-08T04:30:00.000Z');

  it('writes only the rates that moved, stamped, and logs the main rate old to new', async () => {
    const { db, data } = fakeDb({ app_settings: { global: { goldRatePerGram21k: 33_000, goldRatePerGram24k: 38_000, silverRatePerGram: 450 } } });
    const logs: string[] = [];
    const out = await setRates(db, { rates: cleanRates({ goldRatePerGram21k: '33500', goldRatePerGram24k: 38_000, silverRatePerGram: '', bogus: 9 }), by: 'Demo', mainKey: 'goldRatePerGram21k', now },
      { log: (_a, title) => { logs.push(title); } });
    expect(out.moved).toEqual(['goldRatePerGram21k']);
    expect(data.app_settings.global).toEqual({ goldRatePerGram21k: 33_500, goldRatePerGram24k: 38_000, silverRatePerGram: 450, ratesUpdatedAt: now.toISOString(), ratesUpdatedBy: 'Demo' });
    expect(logs[0]).toMatch(/^Rate set: 21K 33,000 → 33,500/);
  });

  it('an unchanged rate is still stamped, as confirmed', async () => {
    const { db, data } = fakeDb({ app_settings: { global: { goldRatePerGram21k: 33_000 } } });
    const logs: string[] = [];
    const out = await setRates(db, { rates: { goldRatePerGram21k: 33_000 }, by: 'Demo', mainKey: 'goldRatePerGram21k', now }, { log: (_a, title) => { logs.push(title); } });
    expect(out.moved).toEqual([]);
    expect(data.app_settings.global.ratesUpdatedAt).toBe(now.toISOString());
    expect(logs[0]).toMatch(/^Rate confirmed: 21K 33,000, unchanged/);
  });

  it('refuses while the database is locked', async () => {
    const { db } = fakeDb({ app_settings: { global: { databaseLocked: true } } });
    await expect(setRates(db, { rates: { goldRatePerGram21k: 1 }, by: 'Demo', mainKey: 'goldRatePerGram21k' })).rejects.toThrow(/locked/);
  });
});

describe('the workshop: karigars and pieces given out', () => {
  it('the last piece given a karigar moves a Pending order on; clearing one never moves it', () => {
    const order = { status: 'Pending', items: [{ description: 'A', karigarId: 'k1' }, { description: 'B' }] };
    const p = pieceKarigarPatch(order, 1, 'k2');
    expect(p.nextStatus).toBe('In Progress');
    expect(p.items[1]).toEqual({ description: 'B', karigarId: 'k2' });
    const cleared = pieceKarigarPatch(order, 0, 'none');
    expect(cleared.items[0]).toEqual({ description: 'A' });
    expect(cleared.nextStatus).toBeNull();
    // Only a Pending order moves.
    expect(pieceKarigarPatch({ ...order, status: 'Completed' }, 1, 'k2').nextStatus).toBeNull();
  });

  it('given out is a time, and taking it back removes it', () => {
    const order = { status: 'In Progress', items: [{ description: 'A', givenAt: '2026-10-01T00:00:00.000Z' }] };
    expect(pieceGivenPatch(order, 0, null).patch).toEqual({ items: [{ description: 'A' }] });
    expect(pieceGivenPatch(order, 0, '2026-10-08T00:00:00.000Z').patch).toEqual({ items: [{ description: 'A', givenAt: '2026-10-08T00:00:00.000Z' }] });
  });

  it('runs on the server the same way', async () => {
    const { db, data } = fakeDb({ orders: { 'ORD-9': { status: 'Pending', items: [{ description: 'A' }] } } });
    const out = await setOrderPieceKarigar(db, { orderId: 'ORD-9', index: 0, karigarId: 'k1', karigarName: 'Demo Karigar' });
    expect(out.status).toBe('In Progress');
    expect(data.orders['ORD-9']).toMatchObject({ status: 'In Progress', items: [{ description: 'A', karigarId: 'k1' }] });
    await setOrderPieceGiven(db, { orderId: 'ORD-9', index: 0, givenAt: '2026-10-08T00:00:00.000Z' });
    expect((data.orders['ORD-9'].items as { givenAt?: string }[])[0].givenAt).toBe('2026-10-08T00:00:00.000Z');
    await expect(setOrderPieceGiven(db, { orderId: 'ORD-9', index: 5, givenAt: null })).rejects.toThrow(/not on this order/);
  });
});

describe('an expense', () => {
  it('a partner-fronted expense and its ledger row point at each other, in one commit', async () => {
    const { db, data } = fakeDb({});
    const e = await addExpense(db, { date: '2026-10-08T10:00:00.000Z', category: 'Shop', description: 'Demo tea', amount: 1_200, paidBy: 'ammar' });
    const ledgerId = e.ledgerEntryId!;
    expect(data.expenses[e.id]).toMatchObject({ description: 'Demo tea', amount: 1_200, ledgerEntryId: ledgerId });
    expect(data.ammar_ledger[ledgerId]).toEqual({
      type: 'payment', category: 'loan', description: 'Expense paid: Demo tea', amount: 1_200,
      date: { ts: '2026-10-08T10:00:00.000Z' }, createdAt: 'server-time', linkedExpenseId: e.id,
    });
  });

  it('the business paying writes no ledger row', async () => {
    const { db, data } = fakeDb({});
    const e = await addExpense(db, { date: '2026-10-08T10:00:00.000Z', category: 'Shop', description: 'Demo bulb', amount: 300, paidBy: 'business' });
    expect(e.ledgerEntryId).toBeUndefined();
    expect(data.ammar_ledger).toBeUndefined();
    expect(data.mina_ledger).toBeUndefined();
  });
});
