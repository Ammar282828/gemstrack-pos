import { describe, expect, it } from 'vitest';
import { recordInvoicePayment } from './invoice-payment';
import type { DbPort, TxCtx } from '@/lib/db-port';

/** An in-memory database that counts commits, so "one trip" is checked, not assumed. */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  let ids = 0;
  const stats = { transactions: 0, batches: 0, directWrites: 0, queries: 0 };
  const col = (c: string) => (data[c] ??= {});
  const db: DbPort = {
    async runTransaction(fn) {
      stats.transactions++;
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? { ...(structuredClone(d) as Record<string, unknown>), id } as never : null; },
        set(c, id, d) { writes.push(() => { col(c)[id] = { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      return out;
    },
    async queryEquals(c, field, value) {
      stats.queries++;
      return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...(d as Record<string, unknown>), id }) as never);
    },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...(d as Record<string, unknown>), id } as never) : null; },
    async add(c, d) { stats.directWrites++; const id = `id${++ids}`; col(c)[id] = d; return id; },
    async update(c, id, d) { stats.directWrites++; col(c)[id] = { ...col(c)[id], ...d }; },
    batch() { stats.batches++; return { set() {}, update() {}, delete() {}, async commit() {} }; },
    newId() { return `new${++ids}`; },
  };
  return { db, data, stats };
}

describe('recording a payment', () => {
  it('pays the invoice, moves the ledger and the order in one commit', async () => {
    const { db, data, stats } = fakeDb({
      invoices: { 'INV-1': { grandTotal: 100_000, amountPaid: 20_000, balanceDue: 80_000, customerId: 'c1', customerName: 'Sakina', sourceOrderId: 'ORD-1', paymentHistory: [{ amount: 20_000, date: 'x' }] } },
      hisaab: { h1: { linkedInvoiceId: 'INV-1', cashDebit: 80_000 }, h2: { linkedInvoiceId: 'INV-1', cashDebit: 80_000 }, h3: { linkedInvoiceId: 'INV-9', cashDebit: 5 } },
      orders: { 'ORD-1': { grandTotal: 80_000 } },
    });
    const out = await recordInvoicePayment(db, { invoiceId: 'INV-1', amount: 30_000, date: '2026-10-01', method: 'Cash' });
    expect(out.balanceDue).toBe(50_000);
    expect(data.invoices['INV-1']).toMatchObject({ amountPaid: 50_000, balanceDue: 50_000 });
    expect(data.hisaab.h1).toMatchObject({ cashDebit: 50_000 });
    expect(data.hisaab.h2).toBeUndefined();          // a duplicate row goes
    expect(data.hisaab.h3).toMatchObject({ cashDebit: 5 }); // another invoice's row is untouched
    expect(data.orders['ORD-1']).toMatchObject({ grandTotal: 50_000 });
    expect(stats).toEqual({ transactions: 1, batches: 0, directWrites: 0, queries: 1 });
  });

  it('paid in full clears the ledger; an invoice with no row gets one only while owing', async () => {
    const { db, data } = fakeDb({
      invoices: { 'INV-2': { grandTotal: 10_000, amountPaid: 0, balanceDue: 10_000, customerId: 'c2', paymentHistory: [] } },
      hisaab: { h1: { linkedInvoiceId: 'INV-2', cashDebit: 10_000 } },
    });
    await recordInvoicePayment(db, { invoiceId: 'INV-2', amount: 10_000, date: 'd' });
    expect(data.hisaab.h1).toBeUndefined();

    const two = fakeDb({ invoices: { 'INV-3': { grandTotal: 10_000, amountPaid: 0, balanceDue: 10_000, customerId: 'c3', paymentHistory: [] } } });
    await recordInvoicePayment(two.db, { invoiceId: 'INV-3', amount: 4_000, date: 'd' });
    expect(Object.values(two.data.hisaab)).toEqual([expect.objectContaining({ linkedInvoiceId: 'INV-3', cashDebit: 6_000, entityId: 'c3' })]);
  });
});
