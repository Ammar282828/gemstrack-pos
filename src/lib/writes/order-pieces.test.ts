import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { CHANGED_ADVANCES, CHANGED_PIECES, deleteOrderAdvance, orderBalance, OrderPieceRefusal, orderWithoutPiece, removeOrderPiece } from './order-pieces';
import { giveInvoiceShareKey } from './invoice-share-key';
import { importShopifyCsv, parseCSVRow, shopifyCsvInvoice, shopifyCsvOrders, shopifyCsvPreview } from './shopify-csv-import';

// One in-memory database behind the port. All names, numbers and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const REMOVE = '<field removed>';
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => {
  const next: Record<string, unknown> = merge ? { ...col(c)[id], ...d } : { ...d };
  for (const [k, v] of Object.entries(next)) if (v === REMOVE) delete next[k];
  col(c)[id] = next;
};
let commits = 0;
const port: DbPort = {
  async runTransaction(fn) {
    const writes: (() => void)[] = [];
    const tx: TxCtx = {
      async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set: (c, id, d, m) => { writes.push(() => put(c, id, d, m)); },
      update: (c, id, d) => { writes.push(() => put(c, id, d, true)); },
      delete: (c, id) => { writes.push(() => { delete col(c)[id]; }); },
    };
    const out = await fn(tx);
    writes.forEach(w => w());
    return out;
  },
  async queryEquals() { return []; },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
  async add() { return 'x'; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { commits++; writes.forEach(w => w()); },
    };
  },
  newId: c => `${c}-new`,
  timestamp: d => d.toISOString(),
  serverTime: () => 'now',
};

const piece = (description: string, totalEstimate: number) => ({ description, totalEstimate, isCompleted: false });

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  commits = 0;
  data.orders = {
    'ORD-1': {
      createdAt: '2026-10-01T10:00:00.000Z',
      items: [piece('Ring', 50000), piece('Chain', 30000), piece('Studs', 20000)],
      subtotal: 100000, discountAmount: 5000, advancePayment: 25000, advanceMethod: 'Cash', advanceInExchangeValue: 10000,
      // 15,000 with the order (Cash), then 10,000 by transfer.
      advances: [{ amount: 10000, date: '2026-10-05T10:00:00.000Z', method: 'Bank Transfer' }],
      grandTotal: 60000,
    },
    'ORD-2': { createdAt: '2026-10-01T10:00:00.000Z', items: [piece('Ring', 1000), piece('Pendant', 2000)], invoiceId: 'INV-000009', subtotal: 3000 },
  };
});

describe('orderBalance', () => {
  it('is the pieces less the discount, the advances and the exchange', () => {
    expect(orderBalance({ subtotal: 100000, discountAmount: 5000, advancePayment: 25000, advanceInExchangeValue: 10000 })).toBe(60000);
    expect(orderBalance({})).toBe(0);
  });
});

describe('orderWithoutPiece', () => {
  it('keeps the advance and the discount in the balance (it used to be the pieces alone)', () => {
    const cut = orderWithoutPiece({ ...data.orders['ORD-1'], id: 'ORD-1' }, 1, 'Chain');
    expect(cut.subtotal).toBe(70000);
    expect(cut.grandTotal).toBe(30000);
    expect(cut.summary).toBe('Ring, Studs');
    expect(cut.items.map(i => i.description)).toEqual(['Ring', 'Studs']);
  });

  it('refuses an invoiced order, a piece that moved, and the last piece', () => {
    expect(() => orderWithoutPiece({ ...data.orders['ORD-2'], id: 'ORD-2' }, 0)).toThrow(/invoiced as INV-000009/);
    expect(() => orderWithoutPiece({ ...data.orders['ORD-1'], id: 'ORD-1' }, 1, 'Ring')).toThrow(CHANGED_PIECES);
    expect(() => orderWithoutPiece({ ...data.orders['ORD-1'], id: 'ORD-1' }, 7)).toThrow(CHANGED_PIECES);
    expect(() => orderWithoutPiece({ id: 'ORD-3', items: [piece('Ring', 1)] as never }, 0)).toThrow(/last item/);
  });
});

describe('removeOrderPiece', () => {
  it('writes the pieces, the totals and the summary, and logs the piece', async () => {
    const logged: string[] = [];
    const out = await removeOrderPiece(port, { orderId: 'ORD-1', index: 0, description: 'Ring' }, { log: (_a, t, d) => { logged.push(`${t} | ${d}`); } });
    expect(out).toMatchObject({ subtotal: 50000, grandTotal: 10000, summary: 'Chain, Studs' });
    expect(data.orders['ORD-1']).toMatchObject({ subtotal: 50000, grandTotal: 10000, summary: 'Chain, Studs' });
    expect(logged).toEqual(['Removed item from order: ORD-1 | Item: Ring']);
  });

  it('touches nothing when refused', async () => {
    await expect(removeOrderPiece(port, { orderId: 'ORD-1', index: 0, description: 'Chain' }, {})).rejects.toBeInstanceOf(OrderPieceRefusal);
    expect((data.orders['ORD-1'].items as unknown[]).length).toBe(3);
  });
});

describe('deleteOrderAdvance', () => {
  const deps = { deleteField: () => REMOVE };

  it('takes the advance given with the order, with its method', async () => {
    const out = await deleteOrderAdvance(port, { orderId: 'ORD-1', lineIndex: 0, amount: 15000 }, deps);
    expect(out.advancePayment).toBe(10000);
    expect(out.grandTotal).toBe(75000);
    expect(data.orders['ORD-1'].advanceMethod).toBeUndefined();
    expect(data.orders['ORD-1'].advances).toHaveLength(1);
  });

  it('takes a later one off the list', async () => {
    const out = await deleteOrderAdvance(port, { orderId: 'ORD-1', lineIndex: 1, amount: 10000 }, deps);
    expect(out.advancePayment).toBe(15000);
    expect(data.orders['ORD-1'].advances).toEqual([]);
    expect(data.orders['ORD-1'].advanceMethod).toBe('Cash');
  });

  it('refuses a line that is not the one shown, and an invoiced order', async () => {
    await expect(deleteOrderAdvance(port, { orderId: 'ORD-1', lineIndex: 1, amount: 15000 }, deps)).rejects.toThrow(CHANGED_ADVANCES);
    await expect(deleteOrderAdvance(port, { orderId: 'ORD-2', lineIndex: 0, amount: 1 }, deps)).rejects.toThrow(/delete the payment on INV-000009/);
    expect(data.orders['ORD-1'].advancePayment).toBe(25000);
  });
});

describe('giveInvoiceShareKey', () => {
  it('gives an invoice without a key one, once, and keeps a key already given', async () => {
    data.invoices = { 'INV-000001': { grandTotal: 1 }, 'INV-000002': { shareToken: 'abcdefghijklmnopqrstuvwx' } };
    const made = 'ZYXWVUTSRQPONMLKJIHGFEDC';
    expect(await giveInvoiceShareKey(port, 'INV-000001', () => made)).toEqual({ shareToken: made, given: true });
    expect(data.invoices['INV-000001'].shareToken).toBe(made);
    expect(await giveInvoiceShareKey(port, 'INV-000001', () => 'other-key-other-key-other')).toEqual({ shareToken: made, given: false });
    expect(await giveInvoiceShareKey(port, 'INV-000002')).toEqual({ shareToken: 'abcdefghijklmnopqrstuvwx', given: false });
    expect(await giveInvoiceShareKey(port, 'INV-404')).toBeNull();
  });
});

const CSV = [
  'Name,Created at,Billing Name,Financial Status,Total,Subtotal,Discount Amount,Lineitem name,Lineitem price,Lineitem quantity,Lineitem sku,Billing Phone',
  '#1002,2026-09-02 10:00:00 +0500,Ayesha Test,pending,5000,5000,0,Studs,5000,1,ST-1,03001234567',
  '#1001,2026-09-01 10:00:00 +0500,Bilal Test,paid,9000,10000,1000,"Ring, small",4000,2,,',
  '#1001,2026-09-01 10:00:00 +0500,Bilal Test,paid,9000,10000,1000,Chain,2000,1,CH-1,',
  'Note,,,,,,,,,,,',
].join('\n');

describe('the Shopify CSV', () => {
  it('reads quoted commas as one field', () => {
    expect(parseCSVRow('a,"b, c",d')).toEqual(['a', 'b, c', 'd']);
  });

  it('previews the rows and the first names, and groups the orders oldest first', () => {
    expect(shopifyCsvPreview(CSV)).toEqual({ rows: 4, firstNames: ['Ayesha Test', 'Bilal Test', 'Bilal Test', 'Walk-in'] });
    const { orders } = shopifyCsvOrders(CSV);
    expect(orders.map(o => o.header.Name)).toEqual(['#1001', '#1002']);
    expect(orders[0].items).toHaveLength(2);
  });

  it('makes an invoice of each order, paid as Shopify says', () => {
    const [first, second] = shopifyCsvOrders(CSV).orders;
    const inv = shopifyCsvInvoice(first, 12, 'now');
    expect(inv).toMatchObject({ id: 'INV-000012', customerName: 'Bilal Test', subtotal: 10000, discountAmount: 1000, grandTotal: 9000, amountPaid: 9000, balanceDue: 0 });
    expect(inv.items[0]).toMatchObject({ sku: 'SHOP-1001-Ring, sm', itemTotal: 8000 });
    expect('adjustmentsAmount' in inv).toBe(false);
    expect(shopifyCsvInvoice(second, 13, 'now')).toMatchObject({ amountPaid: 0, balanceDue: 5000, paymentHistory: [], customerContact: '03001234567' });
  });

  it('takes its numbers first, then writes the invoices', async () => {
    data.app_settings = { global: { lastInvoiceNumber: 40 } };
    const out = await importShopifyCsv(port, CSV);
    expect(out).toEqual({ imported: 2, first: 'INV-000041', last: 'INV-000042' });
    expect(data.app_settings.global.lastInvoiceNumber).toBe(42);
    expect(data.invoices['INV-000041']).toMatchObject({ shopifyOrderName: '#1001', source: 'shopify_import' });
    expect(commits).toBe(1);
  });

  it('stops before writing anything when the counter is stale', async () => {
    data.app_settings = { global: { lastInvoiceNumber: 40 } };
    data.invoices = { 'INV-000042': { grandTotal: 1 } };
    await expect(importShopifyCsv(port, CSV)).rejects.toThrow(/INV-000042 already exists/);
    expect(data.app_settings.global.lastInvoiceNumber).toBe(40);
    expect(data.invoices['INV-000041']).toBeUndefined();
  });
});
