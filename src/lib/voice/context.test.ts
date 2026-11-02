import { describe, expect, it } from 'vitest';
import { contextFrom, contextLines, lookingSection } from './context';
import { nativeVoicePlan } from './native-plan';
import { planRecordEdit } from './record-edit';
import { systemPrompt } from './prompt';
import type { Book } from './args';

// All names, numbers and amounts made up.
const book: Book = {
  roster: [{ id: 'c1', name: 'Sara Testwala', kind: 'customer' }],
  aliases: new Map(),
  customers: [{ id: 'c1', name: 'Sara Testwala', phone: '+923001112222', ringSize: '7' }] as never,
  karigars: [],
  orders: [{ id: 'ORD-000123', customerId: 'c1', customerName: 'Sara Testwala', status: 'Pending', promisedDate: '2026-11-05', subtotal: 200000,
    advancePayment: 20000, grandTotal: 180000, createdAt: '2026-10-30',
    items: [{ description: 'Ring', karat: '21k', metalType: 'gold', estimatedWeightG: 4.5, size: '6' },
      { description: 'Bangle', karat: '21k', metalType: 'gold', estimatedWeightG: 18 }] }] as never,
  invoices: [{ id: 'INV-000045', customerId: 'c1', customerName: 'Sara Testwala', grandTotal: 90000, balanceDue: 10000, amountPaid: 80000,
    paymentStatus: 'Partial', createdAt: '2026-10-29', items: [{ name: 'Pendant', karat: '21k', metalWeightG: 3, sku: 'PEN-1' }] }] as never,
  repairs: [{ id: 'REP-000009', customerName: 'Sara Testwala', status: 'received', pieces: [{ item: 'Chain', work: 'Solder' }], payments: [] }] as never,
  products: [{ sku: 'RIN-000777', name: 'Test ring', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 5, wastagePercentage: 10,
    makingCharges: 3000, hasDiamonds: false, hasStones: false, stoneWeightG: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, isCustomPrice: false,
    qrCodeDataUrl: 'data:x', imageUrl: 'https://example.com/x.jpg' }] as never,
  givenItems: [], karigarJobs: [], expenses: [], extraRevenues: [], destinations: [], today: '2026-11-02',
};
const plan = (steps: string[]) => nativeVoicePlan({ action: 'do', steps }, book, {}, []);

describe('what the person is looking at', () => {
  it('takes only a usable kind and id from the phone', () => {
    expect(contextFrom(null)).toBeNull();
    expect(contextFrom({ kind: 'spaceship', id: 'x' })).toBeNull();
    expect(contextFrom({ kind: 'order', id: '../orders' })).toBeNull();
    expect(contextFrom({ kind: 'order', id: 'ORD-000123', label: 'Order ORD-000123 · Sara\n· 2 pieces', pieces: [{ index: 0, name: 'Ring' }, 'junk'] }))
      .toEqual({ kind: 'order', id: 'ORD-000123', label: 'Order ORD-000123 · Sara · 2 pieces', pieces: [{ index: 0, name: 'Ring' }] });
  });

  it('describes the record from the book, not from what the phone said about it', () => {
    const lines = contextLines({ kind: 'order', id: 'ORD-000123', label: 'Order of 999 pieces', pieces: [] }, book);
    expect(lines[0]).toContain('ORDER ORD-000123');
    expect(lines[0]).toContain('Sara Testwala');
    expect(lines[0]).toContain('due 2026-11-05');
    expect(lines[1]).toBe('  piece 1: Ring · 21k · 4.5 g · size 6');
    expect(lines[2]).toContain('piece 2: Bangle');
    expect(lines.join('\n')).not.toContain('999');
  });

  it('falls back to the phone\'s words for a record the book does not have yet', () => {
    expect(contextLines({ kind: 'order', id: 'ORD-000999', label: 'Sara · 1 piece', pieces: [{ index: 0, name: 'Nose pin' }] }, book))
      .toEqual(['ORDER ORD-000999 · Sara · 1 piece', '  piece 1: Nose pin']);
    expect(contextLines({ kind: 'order', id: 'ORD-000999', label: '', pieces: [] }, book)).toEqual([]);
  });

  it('says which piece is open when one is', () => {
    const ctx = contextFrom({ kind: 'order', id: 'ORD-000123', label: 'Order ORD-000123, piece 2', piece: 1 })!;
    expect(ctx.piece).toBe(1);
    expect(contextLines(ctx, book).at(-1)).toContain('piece 2 of it open');
  });

  it('puts the record and the edit command in the prompt only when something is open', () => {
    const base = { shopName: 'Test shop', today: '2026-11-02', roster: [] };
    expect(systemPrompt(base)).not.toContain('WHAT HE IS LOOKING AT');
    const lines = contextLines({ kind: 'order', id: 'ORD-000123', label: '', pieces: [] }, book);
    const prompt = systemPrompt({ ...base, looking: lines });
    expect(prompt).toContain('=== 8. WHAT HE IS LOOKING AT ===');
    expect(prompt).toContain('ORDER ORD-000123');
    expect(prompt).toContain('edit | kind=');
    expect(lookingSection([])).toBe('');
  });
});

describe('one detail of the record on screen', () => {
  it('changes a piece\'s size, weight and karat through the order\'s own writes', async () => {
    const p = await plan([
      'edit | kind=order | id=ORD-000123 | piece=2 | field=size | value=7',
      'edit | kind=order | id=123 | piece=1 | field=weight | value=12 grams',
      'edit | kind=order | id=ORD-000123 | piece=1 | field=karat | value=22 karat',
    ]);
    expect(p.cards.map(c => c.problem)).toEqual([null, null, null]);
    expect(p.cards[0].operations).toEqual([{ op: 'updateOrderPieceDetails', fields: { orderId: 'ORD-000123', itemIndex: 1, patch: { size: '7' } } }]);
    expect(p.cards[1].operations).toEqual([{ op: 'updateOrderPieceDetails', fields: { orderId: 'ORD-000123', itemIndex: 0, patch: { estimatedWeightG: 12 } } }]);
    // The karat is the order form's field: only the changed piece carries it, the other is kept by its place.
    expect(p.cards[2].operations).toEqual([{ op: 'updateOrder', fields: { orderId: 'ORD-000123', order: { items: [{ karat: '22k', editIndex: 0 }, { editIndex: 1 }] } } }]);
  });

  it('moves the due date and the status, and says which piece when there are several', async () => {
    const p = await plan([
      'edit | kind=order | id=ORD-000123 | field=due date | value=2026-11-07',
      'edit | kind=order | id=ORD-000123 | field=status | value=ready',
      'edit | kind=order | id=ORD-000123 | field=size | value=7',
    ]);
    expect(p.cards[0].operations).toEqual([{ op: 'updateOrder', fields: { orderId: 'ORD-000123', order: { promisedDate: '2026-11-07', items: [{ editIndex: 0 }, { editIndex: 1 }] } } }]);
    expect(p.cards[1].operations).toEqual([{ op: 'setOrderStatus', fields: { orderId: 'ORD-000123', status: 'Completed' } }]);
    expect(p.cards[2].operations).toEqual([]);
    expect(p.cards[2].problem).toContain('Which piece');
  });

  it('changes a customer\'s phone and a stock piece\'s weight with the whole form the stock write checks', async () => {
    const p = await plan([
      'edit | kind=customer | id=Sara Testwala | field=phone | value=0300 999 8888',
      'edit | kind=product | id=RIN-000777 | field=weight | value=5.5',
    ]);
    expect(p.cards[0].operations).toEqual([{ op: 'updateCustomer', fields: { customerId: 'c1', patch: { phone: '03009998888' } } }]);
    const product = p.cards[1].operations[0];
    expect(product.op).toBe('updateProduct');
    expect(product.fields).toMatchObject({ sku: 'RIN-000777', piece: { metalWeightG: 5.5, categoryId: 'cat001', karat: '21k', makingCharges: 3000 } });
    // Only the form's own fields: a photo or the QR is never sent back.
    expect(Object.keys(product.fields.piece as object)).not.toContain('imageUrl');
    expect(Object.keys(product.fields.piece as object)).not.toContain('qrCodeDataUrl');
  });

  it('refuses money, unknown fields and a sold piece\'s weight, preparing nothing', async () => {
    const p = await plan([
      'edit | kind=order | id=ORD-000123 | field=grand total | value=1000',
      'edit | kind=invoice | id=INV-000045 | piece=1 | field=weight | value=9',
      'edit | kind=order | id=ORD-000999 | piece=1 | field=size | value=7',
      'edit | kind=order | id=ORD-000123 | piece=5 | field=size | value=7',
    ]);
    for (const card of p.cards) {
      expect(card.operations).toEqual([]);
      expect(card.problem).toBeTruthy();
    }
    expect(p.cards[2].problem).toContain('No order');
    expect(p.cards[3].problem).toContain('no piece 5');
  });

  it('keeps an advance on the record a confirmed money step, and calls the customer on screen', async () => {
    const p = await plan(['order_advance | order=123 | amount=5000', 'call | person=Sara Testwala']);
    expect(p.cards[0].operations).toEqual([{ op: 'recordOrderAdvance', fields: expect.objectContaining({ orderId: 'ORD-000123', amount: 5000 }) }]);
    expect(p.cards[1].operations).toEqual([]);
    expect(p.cards[1].href).toBe('tel:+923001112222');
  });

  it('checks a repair\'s status against its own words', () => {
    const s = { orders: book.orders, generatedInvoices: book.invoices, customers: book.customers, karigars: [], products: book.products, repairs: book.repairs } as never;
    const ok = planRecordEdit({ kind: 'repair', id: 'REP-000009', field: 'status', value: 'done' }, s, '2026-11-02');
    expect(ok).toMatchObject({ ok: true, value: 'ready', said: 'REP-000009: status to ready.' });
    expect(planRecordEdit({ kind: 'repair', id: 'REP-000009', field: 'status', value: 'flying' }, s, '2026-11-02')).toMatchObject({ ok: false });
  });
});
