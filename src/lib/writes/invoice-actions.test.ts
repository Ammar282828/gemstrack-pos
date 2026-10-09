import { describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { updateInvoiceDiscount } from './invoice-discount';
import { refundInvoicePartial } from './invoice-refund';
import { deleteInvoice, deleteInvoiceWhat, restockedProduct } from './invoice-delete';

// The invoice page's own actions, as the store runs them and the iPhone app's route does. All names and figures made up.

const REMOVE = '<field removed>';

/** An in-memory database that counts trips, merges a merge-set as Firestore does, and refuses an update to nothing. */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  let ids = 0;
  const stats = { transactions: 0, commits: 0 };
  const col = (c: string) => (data[c] ??= {});
  const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
    const next: Record<string, unknown> = merge ? { ...col(c)[id], ...d } : { ...d };
    for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
    col(c)[id] = next;
  };
  const db: DbPort = {
    async runTransaction(fn) {
      stats.transactions++;
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
        update(c, id, d) {
          if (!col(c)[id]) throw new Error(`No document to update: ${c}/${id}`);
          writes.push(() => put(c, id, d, true));
        },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      return out;
    },
    async queryEquals(c, field, value) {
      return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...structuredClone(d), id }) as never);
    },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
    async add(c, d) { const id = `auto${++ids}`; put(c, id, d); return id; },
    async update(c, id, d) { put(c, id, d, true); },
    batch() {
      const writes: (() => void)[] = [];
      return {
        set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => put(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
        async commit() { stats.commits++; writes.forEach(w => w()); },
      };
    },
    newId(c) { return `${c}-new${++ids}`; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data, stats };
}

describe('changing the discount', () => {
  const seed = () => ({
    invoices: { 'INV-1': { subtotal: 200_000, discountAmount: 0, exchangeAmount1: 20_000, grandTotal: 180_000, amountPaid: 50_000, balanceDue: 130_000,
      customerId: 'c1', customerName: 'Sakina Demo', createdAt: '2026-10-01T10:00:00.000Z', sourceOrderId: 'ORD-1' } },
    hisaab: {
      h1: { linkedInvoiceId: 'INV-1', cashDebit: 130_000 },
      h2: { linkedInvoiceId: 'INV-1', cashDebit: 130_000 },
      h9: { linkedInvoiceId: 'INV-9', cashDebit: 7 },
    },
    orders: { 'ORD-1': { grandTotal: 130_000 } },
  });

  it('moves the total, the ledger row and the order in one commit, and logs it as the store does', async () => {
    const { db, data, stats } = fakeDb(seed());
    const log = vi.fn();
    const sync = vi.fn();
    const out = await updateInvoiceDiscount(db, { invoiceId: 'INV-1', discountAmount: 10_000 }, { log, syncInvoiceShopify: sync });
    expect(out).toMatchObject({ id: 'INV-1', discountAmount: 10_000, grandTotal: 170_000, balanceDue: 120_000, customerName: 'Sakina Demo' });
    expect(data.invoices['INV-1']).toMatchObject({ discountAmount: 10_000, grandTotal: 170_000, balanceDue: 120_000, amountPaid: 50_000 });
    expect(data.hisaab.h1).toMatchObject({ cashDebit: 120_000 });
    expect(data.hisaab.h2).toBeUndefined();               // a duplicate row goes
    expect(data.hisaab.h9).toEqual({ linkedInvoiceId: 'INV-9', cashDebit: 7 });
    expect(data.orders['ORD-1']).toEqual({ grandTotal: 120_000 });
    expect(stats.transactions).toBe(1);
    expect(log).toHaveBeenCalledWith('invoice.update', 'Discount updated on invoice INV-1', `Discount: ${(10_000).toLocaleString()} | New total: ${(170_000).toLocaleString()}`, 'INV-1');
    expect(sync).toHaveBeenCalledWith('INV-1', 'upsert');
  });

  it('nothing left owing takes the ledger row away', async () => {
    const s = seed();
    s.invoices['INV-1'].amountPaid = 170_000;
    const { db, data } = fakeDb(s);
    const out = await updateInvoiceDiscount(db, { invoiceId: 'INV-1', discountAmount: 15_000 });
    expect(out.balanceDue).toBe(-5_000);
    expect(data.hisaab.h1).toBeUndefined();
    expect(data.hisaab.h2).toBeUndefined();
    expect(data.orders['ORD-1']).toEqual({ grandTotal: -5_000 });
  });

  it('a named customer owing with no row gets one; a walk-in does not', async () => {
    const named = fakeDb({ invoices: { 'INV-2': { subtotal: 10_000, grandTotal: 10_000, amountPaid: 0, customerId: 'c2', customerName: 'Hamza Demo', createdAt: 'when' } } });
    await updateInvoiceDiscount(named.db, { invoiceId: 'INV-2', discountAmount: 1_000 });
    expect(Object.values(named.data.hisaab)).toEqual([{
      entityId: 'c2', entityType: 'customer', entityName: 'Hamza Demo', date: 'when', description: 'Outstanding balance for Invoice INV-2',
      cashDebit: 9_000, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0, linkedInvoiceId: 'INV-2',
    }]);

    const walkIn = fakeDb({ invoices: { 'INV-3': { subtotal: 10_000, grandTotal: 10_000, amountPaid: 0, customerId: 'walk-in' } } });
    await updateInvoiceDiscount(walkIn.db, { invoiceId: 'INV-3', discountAmount: 1_000 });
    expect(walkIn.data.hisaab ?? {}).toEqual({});
    expect(walkIn.data.invoices['INV-3']).toMatchObject({ grandTotal: 9_000, balanceDue: 9_000 });
  });

  it('refuses more than the lines come to, and writes nothing', async () => {
    const { db, data } = fakeDb(seed());
    await expect(updateInvoiceDiscount(db, { invoiceId: 'INV-1', discountAmount: 200_001 })).rejects.toThrow('Discount cannot exceed subtotal.');
    await expect(updateInvoiceDiscount(db, { invoiceId: 'INV-1', discountAmount: -5 })).rejects.toThrow('Discount cannot be negative.');
    await expect(updateInvoiceDiscount(db, { invoiceId: 'INV-404', discountAmount: 5 })).rejects.toThrow('Invoice not found!');
    expect(data).toEqual(seed());
  });
});

describe('a partial refund', () => {
  it('is a negative payment; the customer owes it again on the ledger; Shopify refunds the same', async () => {
    const { db, data, stats } = fakeDb({
      invoices: { 'INV-1': { grandTotal: 100_000, amountPaid: 100_000, balanceDue: 0, customerId: 'c1', customerName: 'Sakina Demo', createdAt: 'when',
        sourceOrderId: 'ORD-1', paymentHistory: [{ amount: 100_000, date: 'd1', method: 'Cash' }] } },
      orders: { 'ORD-1': { grandTotal: 0 } },
    });
    const log = vi.fn();
    const refundOnShopify = vi.fn();
    const out = await refundInvoicePartial(db, { invoiceId: 'INV-1', amount: 15_000, reason: 'damaged item', date: '2026-10-09T10:00:00.000Z' }, { log, refundOnShopify });
    expect(out).toMatchObject({ amountPaid: 85_000, balanceDue: 15_000 });
    expect(data.invoices['INV-1'].paymentHistory).toEqual([
      { amount: 100_000, date: 'd1', method: 'Cash' },
      { amount: -15_000, date: '2026-10-09T10:00:00.000Z', notes: 'Refund: damaged item' },
    ]);
    expect(Object.values(data.hisaab)).toEqual([expect.objectContaining({ entityId: 'c1', cashDebit: 15_000, linkedInvoiceId: 'INV-1', description: 'Outstanding balance for Invoice INV-1' })]);
    // The store's refund leaves the order's figures as they were.
    expect(data.orders['ORD-1']).toEqual({ grandTotal: 0 });
    expect(stats.transactions).toBe(1);
    expect(log).toHaveBeenCalledWith('invoice.refund', 'Partial refund on invoice INV-1', `Amount: ${(15_000).toLocaleString()} | damaged item`, 'INV-1');
    expect(refundOnShopify).toHaveBeenCalledWith('INV-1', 15_000, 'damaged item');
  });

  it('keeps one ledger row at the new balance', async () => {
    const { db, data } = fakeDb({
      invoices: { 'INV-2': { grandTotal: 50_000, amountPaid: 30_000, balanceDue: 20_000, customerId: 'c2', paymentHistory: [{ amount: 30_000, date: 'd' }] } },
      hisaab: { h1: { linkedInvoiceId: 'INV-2', cashDebit: 20_000 }, h2: { linkedInvoiceId: 'INV-2', cashDebit: 20_000 } },
    });
    await refundInvoicePartial(db, { invoiceId: 'INV-2', amount: 5_000 });
    expect(data.hisaab).toEqual({ h1: { linkedInvoiceId: 'INV-2', cashDebit: 25_000 } });
    const entry = (data.invoices['INV-2'].paymentHistory as { notes: string; date: string }[])[1];
    expect(entry.notes).toBe('Refund');
    expect(Number.isNaN(Date.parse(entry.date))).toBe(false);
  });

  it('still paid in full (it was in credit), the ledger is left as the store leaves it', async () => {
    const { db, data } = fakeDb({
      invoices: { 'INV-3': { grandTotal: 10_000, amountPaid: 12_000, balanceDue: -2_000, customerId: 'c3', paymentHistory: [{ amount: 12_000, date: 'd' }] } },
      hisaab: { h1: { linkedInvoiceId: 'INV-3', cashCredit: 2_000, cashDebit: 0, description: 'Credit held for Invoice INV-3' } },
    });
    const out = await refundInvoicePartial(db, { invoiceId: 'INV-3', amount: 2_000 });
    expect(out.balanceDue).toBe(0);
    expect(data.hisaab.h1).toMatchObject({ cashCredit: 2_000 });
  });

  it('a walk-in owing again gets no row; a Shopify order\'s own invoice sends nothing back to Shopify', async () => {
    const { db, data } = fakeDb({
      invoices: { 'SHOPIFY-1416': { grandTotal: 7_850, amountPaid: 7_850, balanceDue: 0, customerId: 'walk-in', paymentHistory: [{ amount: 7_850, date: 'd' }] } },
    });
    const refundOnShopify = vi.fn();
    await refundInvoicePartial(db, { invoiceId: 'SHOPIFY-1416', amount: 850 }, { refundOnShopify });
    expect(data.hisaab ?? {}).toEqual({});
    expect(data.invoices['SHOPIFY-1416']).toMatchObject({ amountPaid: 7_000, balanceDue: 850 });
    expect(refundOnShopify).not.toHaveBeenCalled();
  });

  it('refuses nothing to refund, and an invoice not on file', async () => {
    const { db } = fakeDb({ invoices: { 'INV-4': { grandTotal: 1_000, paymentHistory: [] } } });
    await expect(refundInvoicePartial(db, { invoiceId: 'INV-4', amount: 0 })).rejects.toThrow('Enter a refund amount greater than 0.');
    await expect(refundInvoicePartial(db, { invoiceId: 'INV-404', amount: 10 })).rejects.toThrow('Invoice not found');
  });
});

describe('deleting an invoice', () => {
  const deps = (invoices: { id: string; items?: unknown }[] = []) => ({ deleteField: () => REMOVE, invoices: vi.fn(() => invoices) });
  const line = (sku: string, more: Record<string, unknown> = {}) => ({
    sku, name: `Piece ${sku}`, categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 4.2, stoneWeightG: 0,
    wastagePercentage: 10, makingCharges: 5_000, diamondChargesIfAny: 0, stoneChargesIfAny: 0, miscChargesIfAny: 0,
    unitPrice: 90_000, ...more,
  });

  it('puts its pieces back, takes its ledger rows, unlinks its order, in one commit; then logs and cancels on Shopify', async () => {
    const { db, data, stats } = fakeDb({
      invoices: {
        'INV-2': { customerName: 'Sakina Demo', sourceOrderId: 'ORD-1', shopifyOrderId: 99001, items: [
          line('RNG-001', { isCustomPrice: true, unitPrice: 75_000, stoneChargesIfAny: 2_000, stoneDetails: '1 ruby' }),
          line('ORD-000001-1'),
          line('BNG-002'),
        ] },
        'INV-1': { items: [line('BNG-002')] },
      },
      sold_products: { 'RNG-001': { sku: 'RNG-001' }, 'BNG-002': { sku: 'BNG-002' } },
      hisaab: { h1: { linkedInvoiceId: 'INV-2', cashDebit: 5_000 }, h2: { linkedInvoiceId: 'INV-2', cashCredit: 300 }, h9: { linkedInvoiceId: 'INV-9', cashDebit: 1 } },
      orders: { 'ORD-1': { invoiceId: 'INV-2', status: 'Completed' } },
    });
    const d = deps([{ id: 'INV-2', items: [line('RNG-001')] }, { id: 'INV-1', items: [line('BNG-002')] }]);
    const log = vi.fn();
    const shopify = vi.fn();
    const out = await deleteInvoice(db, { invoiceId: 'INV-2' }, d, { log, shopify });

    expect(out).toEqual({ deleted: true, invoiceId: 'INV-2', customerName: 'Sakina Demo', restocked: ['RNG-001'], ledgerRows: 2, order: { id: 'ORD-1', invoiceId: null } });
    expect(data.invoices['INV-2']).toBeUndefined();
    expect(data.products['RNG-001']).toEqual({
      sku: 'RNG-001', name: 'Piece RNG-001', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 4.2,
      hasStones: true, stoneWeightG: 0, wastagePercentage: 10, makingCharges: 5_000, hasDiamonds: false,
      diamondCharges: 0, stoneCharges: 2_000, miscCharges: 0, stoneDetails: '1 ruby', isCustomPrice: true, customPrice: 75_000,
    });
    expect(data.sold_products['RNG-001']).toBeUndefined();
    expect(data.sold_products['BNG-002']).toEqual({ sku: 'BNG-002' });   // INV-1 sold it too: it stays sold
    expect(data.products['BNG-002']).toBeUndefined();
    expect(data.products['ORD-000001-1']).toBeUndefined();               // made for the order, never stock
    expect(data.hisaab).toEqual({ h9: { linkedInvoiceId: 'INV-9', cashDebit: 1 } });
    expect(data.orders['ORD-1']).toEqual({ status: 'Completed' });         // the link went, nothing else
    expect(stats.commits).toBe(1);
    expect(log).toHaveBeenCalledWith('invoice.delete', 'Deleted invoice INV-2', 'Customer: Sakina Demo', 'INV-2');
    expect(shopify).toHaveBeenCalledWith({ path: '/api/shopify/sync/invoice', body: { invoiceId: 'INV-2', shopifyOrderId: '99001', action: 'cancel' } });
    expect(deleteInvoiceWhat('INV-2')).toBe('Delete invoice INV-2');
  });

  it('an order with a second invoice for it is linked to that one; one linked elsewhere is left alone', async () => {
    const twice = fakeDb({
      invoices: { 'INV-5': { sourceOrderId: 'ORD-2', items: [] }, 'INV-7': { sourceOrderId: 'ORD-2', items: [] } },
      orders: { 'ORD-2': { invoiceId: 'INV-5' } },
    });
    const one = await deleteInvoice(twice.db, { invoiceId: 'INV-5' }, deps());
    expect(one.order).toEqual({ id: 'ORD-2', invoiceId: 'INV-7' });
    expect(twice.data.orders['ORD-2']).toEqual({ invoiceId: 'INV-7' });

    const elsewhere = fakeDb({
      invoices: { 'INV-5': { sourceOrderId: 'ORD-2', items: [] } },
      orders: { 'ORD-2': { invoiceId: 'INV-8', status: 'Completed' } },
    });
    const two = await deleteInvoice(elsewhere.db, { invoiceId: 'INV-5' }, deps());
    expect(two.order).toBeUndefined();
    expect(elsewhere.data.orders['ORD-2']).toEqual({ invoiceId: 'INV-8', status: 'Completed' });
  });

  it('an order that has gone is left gone', async () => {
    const { db, data } = fakeDb({ invoices: { 'INV-6': { sourceOrderId: 'ORD-GONE', items: [] } } });
    const out = await deleteInvoice(db, { invoiceId: 'INV-6' }, deps());
    expect(out.order).toBeUndefined();
    expect(data.orders ?? {}).toEqual({});
  });

  it('reads the other invoices only when a piece could go back', async () => {
    const { db } = fakeDb({ invoices: { 'INV-8': { items: [line('ORD-000004-1')] } } });
    const d = deps();
    await deleteInvoice(db, { invoiceId: 'INV-8' }, d);
    expect(d.invoices).not.toHaveBeenCalled();
  });

  it('no Shopify order, a Shopify order\'s own invoice, or the caller settling Shopify: nothing sent', async () => {
    const shopify = vi.fn();
    for (const [id, doc, syncShopify] of [
      ['INV-9', { items: [] }, true],
      ['SHOPIFY-1416', { items: [], shopifyOrderId: 5 }, true],
      ['INV-10', { items: [], shopifyOrderId: 6 }, false],
    ] as const) {
      const { db } = fakeDb({ invoices: { [id]: doc } });
      await deleteInvoice(db, { invoiceId: id, syncShopify }, deps(), { shopify });
    }
    expect(shopify).not.toHaveBeenCalled();
  });

  it('an invoice not on file: nothing is written', async () => {
    const { db, data, stats } = fakeDb({ invoices: { 'INV-1': { items: [] } } });
    const log = vi.fn();
    expect(await deleteInvoice(db, { invoiceId: 'INV-404' }, deps(), { log })).toEqual({ deleted: false, invoiceId: 'INV-404', restocked: [], ledgerRows: 0 });
    expect(data.invoices['INV-1']).toEqual({ items: [] });
    expect(stats.commits).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('a piece comes back without the fields its line never had', () => {
    expect(restockedProduct({ sku: 'X-1', name: 'Chain' })).toEqual({ sku: 'X-1', name: 'Chain', hasStones: false, hasDiamonds: false });
  });
});
