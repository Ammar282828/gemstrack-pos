import { describe, expect, it } from 'vitest';
import { payBackCredit, PaybackRefusal } from './invoice-credit-payback';
import { recordInvoicePayment, removeInvoicePayment } from './invoice-payment';
import { todaysCash } from '@/lib/analytics/todays-cash';
import { cashInForPeriod } from '@/lib/analytics/cash-in';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { creditPaidBack } from '@/lib/invoice-credit';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { Expense, Invoice } from '@/lib/store';

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
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data, stats };
}


const NOW = new Date('2026-10-24T10:00:00Z');
const credit = () => fakeDb({
  invoices: { 'INV-1': { grandTotal: 100_000, amountPaid: 120_000, balanceDue: -20_000, customerId: 'c1', customerName: 'Sakina', createdAt: '2026-10-20T10:00:00Z',
    paymentHistory: [{ amount: 120_000, date: '2026-10-20T10:00:00Z', method: 'Cash' }] } },
  hisaab: { h1: { linkedInvoiceId: 'INV-1', cashCredit: 20_000, cashDebit: 0, description: 'Credit held for Invoice INV-1' }, h9: { linkedInvoiceId: 'INV-9', cashCredit: 5 } },
});

describe('giving credit back', () => {
  it('the whole credit by default: settled, the credit row gone, a negative payback line, one commit', async () => {
    const { db, data, stats } = credit();
    const out = await payBackCredit(db, { invoiceId: 'INV-1', method: 'Cash', date: '2026-10-24T09:00:00Z' });
    expect(out.paidBack).toBe(20_000);
    expect(data.invoices['INV-1']).toMatchObject({ amountPaid: 100_000, balanceDue: 0 });
    expect(data.invoices['INV-1'].status).toBeUndefined();   // never marked Refunded
    const last = (data.invoices['INV-1'].paymentHistory as Record<string, unknown>[]).at(-1);
    expect(last).toMatchObject({ amount: -20_000, kind: 'credit-payback', method: 'Cash' });
    expect(data.hisaab.h1).toBeUndefined();
    expect(data.hisaab.h9).toBeDefined();
    expect(stats.transactions).toBe(1);
  });

  it('a part brings the credit down and keeps its row at what is left', async () => {
    const { db, data } = credit();
    await payBackCredit(db, { invoiceId: 'INV-1', amount: 5_000, method: 'Bank Transfer' });
    expect(data.invoices['INV-1']).toMatchObject({ amountPaid: 115_000, balanceDue: -15_000 });
    expect(data.hisaab.h1).toMatchObject({ cashCredit: 15_000 });
    await payBackCredit(db, { invoiceId: 'INV-1' });
    expect(data.invoices['INV-1']).toMatchObject({ balanceDue: 0 });
    expect(data.hisaab.h1).toBeUndefined();
  });

  it('refuses more than the credit held, nothing paid, a refunded invoice, and a walk-in', async () => {
    const { db, data } = credit();
    await expect(payBackCredit(db, { invoiceId: 'INV-1', amount: 20_001 })).rejects.toBeInstanceOf(PaybackRefusal);
    await expect(payBackCredit(db, { invoiceId: 'INV-1', amount: 0 })).rejects.toThrow();
    await expect(payBackCredit(db, { invoiceId: 'INV-1', amount: -5 })).rejects.toThrow();
    expect(data.invoices['INV-1']).toMatchObject({ balanceDue: -20_000 });

    const owing = fakeDb({ invoices: { 'INV-2': { grandTotal: 10_000, amountPaid: 4_000, balanceDue: 6_000, customerId: 'c1', paymentHistory: [{ amount: 4_000, date: 'x' }] } } });
    await expect(payBackCredit(owing.db, { invoiceId: 'INV-2' })).rejects.toThrow(/no credit/);
    const refunded = fakeDb({ invoices: { 'INV-3': { grandTotal: 10_000, amountPaid: 12_000, balanceDue: -2_000, status: 'Refunded', customerId: 'c1', paymentHistory: [] } } });
    await expect(payBackCredit(refunded.db, { invoiceId: 'INV-3' })).rejects.toThrow(/refunded/);
    const walkIn = fakeDb({ invoices: { 'INV-4': { grandTotal: 10_000, amountPaid: 12_000, balanceDue: -2_000, customerId: 'walk-in', paymentHistory: [] } } });
    await expect(payBackCredit(walkIn.db, { invoiceId: 'INV-4' })).rejects.toThrow(/walk-in/);
    await expect(payBackCredit(fakeDb({}).db, { invoiceId: 'NOPE' })).rejects.toThrow(/not found/);
  });

  it('rounds to whole rupees', async () => {
    const { db, data } = credit();
    await payBackCredit(db, { invoiceId: 'INV-1', amount: 999.6 });
    expect(data.invoices['INV-1']).toMatchObject({ balanceDue: -19_000 });
  });

  it('a retry with the same request name pays back once', async () => {
    const { db, data } = credit();
    const first = await payBackCredit(db, { invoiceId: 'INV-1', amount: 8_000, requestId: 'req-abcdef12' });
    const again = await payBackCredit(db, { invoiceId: 'INV-1', amount: 8_000, requestId: 'req-abcdef12' });
    expect(first.paidBack).toBe(8_000);
    expect(again.paidBack).toBe(8_000);
    expect(data.invoices['INV-1']).toMatchObject({ amountPaid: 112_000, balanceDue: -12_000 });
    expect((data.invoices['INV-1'].paymentHistory as unknown[]).length).toBe(2);
  });

  it('deleting the payback line puts the credit back; paying past the total again works', async () => {
    const { db, data } = credit();
    await payBackCredit(db, { invoiceId: 'INV-1', date: '2026-10-24T09:00:00Z' });
    await removeInvoicePayment(db, { invoiceId: 'INV-1', index: 1, amount: -20_000, date: '2026-10-24T09:00:00Z' });
    expect(data.invoices['INV-1']).toMatchObject({ balanceDue: -20_000 });
    expect(Object.values(data.hisaab).some(r => r.linkedInvoiceId === 'INV-1' && r.cashCredit === 20_000)).toBe(true);
    await recordInvoicePayment(db, { invoiceId: 'INV-1', amount: 1_000, date: '2026-10-24' });
    expect(data.invoices['INV-1']).toMatchObject({ balanceDue: -21_000 });
  });

  it('shows as money out in Today\'s cash and Cash In, and leaves revenue alone', async () => {
    const { db, data } = credit();
    await payBackCredit(db, { invoiceId: 'INV-1', amount: 15_000, method: 'Cash', date: '2026-10-24T09:00:00Z' });
    const inv = { ...data.invoices['INV-1'], id: 'INV-1', status: 'Paid' } as unknown as Invoice;
    const earlier = { ...inv, paymentHistory: [{ amount: 120_000, date: '2026-10-24T08:00:00Z', method: 'Cash' }, ...(inv.paymentHistory as unknown[]).slice(1)] } as unknown as Invoice;
    const t = todaysCash({ invoices: [earlier], orders: [], repairs: [], extraRevenues: [], expenses: [{ id: 'e', date: '2026-10-24T09:30:00Z', amount: 500, category: 'Tea', description: 'Tea' }] as unknown as Expense[], now: NOW });
    expect(t.paidBack).toBe(15_000);
    expect(t.lines.find(l => l.payback)).toMatchObject({ amount: -15_000, method: 'Cash' });
    expect(t.byMethod.Cash).toBe(105_000);          // the drawer lost what was handed over
    expect(t.netCash).toBe(104_500);
    const cash = cashInForPeriod({ invoices: [earlier], orders: [], invoiced: new Set(), extraRevenues: [], period: { from: new Date('2026-10-24T00:00:00Z'), to: new Date('2026-10-24T23:59:59Z') } });
    expect(cash.paidBack).toBe(15_000);
    expect(cash.invoicePayments).toBe(105_000);
    expect(invoiceSaleValue(inv)).toBe(100_000);   // the sale is worth what it was
    expect(creditPaidBack(inv.paymentHistory)).toBe(15_000);
  });
});
