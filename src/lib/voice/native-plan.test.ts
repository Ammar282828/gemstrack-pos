import { describe, expect, it } from 'vitest';
import { nativeVoicePlan } from './native-plan';
import type { Book } from './args';

const book: Book = {
  roster: [{ id: 'c1', name: 'Rashida Modi', kind: 'customer' }, { id: 'k1', name: 'Ahsan Meena', kind: 'karigar' }, { id: 'k2', name: 'Ahsan Box', kind: 'karigar' }],
  aliases: new Map(), customers: [{ id: 'c1', name: 'Rashida Modi' }] as never, karigars: [],
  orders: [{ id: 'ORD-000041', customerId: 'c1', customerName: 'Rashida Modi', status: 'Pending', subtotal: 300000,
    advancePayment: 30000, grandTotal: 270000, items: [{ description: 'Ring', karigarId: '' }], createdAt: '2026-09-30' }] as never,
  invoices: [{ id: 'INV-000012', customerId: 'c1', customerName: 'Rashida Modi', grandTotal: 10000, balanceDue: 8000,
    amountPaid: 2000, paymentStatus: 'Partial', items: [], createdAt: '2026-09-30' }] as never,
  repairs: [], products: [], givenItems: [], karigarJobs: [], expenses: [], extraRevenues: [],
  destinations: [{ label: 'Analytics', href: '/analytics', keywords: [] }], today: '2026-10-01',
};
const plan = (raw: Parameters<typeof nativeVoicePlan>[0]) => nativeVoicePlan(raw, book, { goldRatePerGram21k: 35000 }, []);

describe('the native voice review', () => {
  it('prepares an expense without writing or changing the book, and derives the review from the resolved figure', async () => {
    const before = JSON.stringify(book);
    const p = await plan({ action: 'expense', amount: 500, description: 'Tea', summary: 'Wrong model summary: 900 rupees', transcript: 'tea 500' });
    expect(p.cards[0].operations).toEqual([{ op: 'addExpense', fields: expect.objectContaining({ amount: 500, description: 'Tea', paidBy: 'business' }) }]);
    expect(p.cards[0].summary).not.toContain('900');
    expect(JSON.stringify(book)).toBe(before);
  });
  it('keeps the ledger columns and person kind from the shared resolver', async () => {
    const p = await nativeVoicePlan({ action: 'record_payment', person: { name: 'Rashida Modi', kind: 'customer' }, amount: 500, description: 'Cash received' }, { ...book, invoices: [] }, {}, []);
    expect(p.cards[0].operations[0]).toMatchObject({ op: 'addHisaabEntry', fields: { entityId: 'c1', entityType: 'customer', cashCredit: 500, cashDebit: 0 } });
  });
  it('does not guess an ambiguous person or prepare any write', async () => {
    const p = await plan({ action: 'record_payout', person: { name: 'Ahsan', kind: 'karigar' }, amount: 500 });
    expect(p.cards[0].problem).toBeTruthy();
    expect(p.cards[0].operations).toEqual([]);
  });
  it('routes rates through setRates and prepares all pieces for the normal workshop operations', async () => {
    const p = await plan({ action: 'do', steps: ['set_rate | metal=21k | rate=34000', 'order_assign | order=41 | karigar=Ahsan Meena'] });
    expect(p.cards[0].operations).toEqual([{ op: 'setRates', fields: { rates: { goldRatePerGram21k: 34000 } } }]);
    expect(p.cards[1].operations).toEqual([{ op: 'setPieceKarigar', fields: { orderId: 'ORD-000041', index: 0, karigarId: 'k1' } }]);
  });
  it('opens native sale/order forms with the complete draft instead of creating anything', async () => {
    const p = await plan({ action: 'do', steps: ['new_order | customer=Rashida Modi | piece=Ring | weight=4 | karat=21k | advance=10000'] });
    expect(p.cards[0].operations).toEqual([]);
    expect(p.cards[0]).toMatchObject({ href: '/orders/add?voice=1', handoff: { kind: 'order', payload: { advancePayment: 10000, items: [{ description: 'Ring', weightG: 4, karat: 21 }] } } });
  });
  it('keeps destructive changes behind the record’s existing code flow', async () => {
    const p = await plan({ action: 'do', steps: ['delete_order | order=41'] });
    expect(p.cards[0].operations).toEqual([]);
    expect(p.cards[0].problem).toContain('delete code');
    expect(p.cards[0].href).toBe('/orders/ORD-000041');
  });
  it('does not half-prepare an unsupported change or silently drop an unknown command', async () => {
    const p = await plan({ action: 'do', steps: ['order_promise | order=41 | date=2026-10-20'] });
    expect(p.cards[0].operations).toEqual([]);
    expect(p.cards[0].problem).toBeTruthy();
    expect((await plan({ action: 'do', steps: ['launch_rocket'] })).answer).toContain('Not recognised');
  });
});
