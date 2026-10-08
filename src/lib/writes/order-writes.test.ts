import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { orderStatusPatch, pieceDonePatch, setOrderPieceDone, setOrderStatus } from './order-status';
import { recordOrderAdvance } from './order-advance';

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
    batch() { return { set() {}, update() {}, delete() {}, async commit() {} }; },
    newId() { return 'n'; },
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
