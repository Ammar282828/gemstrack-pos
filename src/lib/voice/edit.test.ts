import { describe, expect, it } from 'vitest';
import { resolveIntent, type RawIntent } from './resolve';
import { applyEdit, describeReading, newDraft, readDraft, type Draft } from './edit';
import type { DocEntry } from './documents';
import type { RosterEntry } from './phonetics';

const roster: RosterEntry[] = [
  { id: 'c1', name: 'Alifya Burhanuddin', kind: 'customer' },
  { id: 'c2', name: 'Alifya Saifee', kind: 'customer' },
  { id: 'c3', name: 'Rashida Modi', kind: 'customer' },
  { id: 'k1', name: 'Uzair', kind: 'karigar' },
];
const inv = (id: string, customerId: string, customerName: string, balance: number): DocEntry => ({
  kind: 'invoice', id, customerId, customerName, label: `Rs ${balance} due`, balance, open: balance > 0, createdAt: '2026-10-01T00:00:00Z', href: `/invoices/${id}`,
});
const ord = (id: string, customerId: string, customerName: string, balance: number): DocEntry => ({
  kind: 'order', id, customerId, customerName, label: 'open', balance, open: true, status: 'Pending', createdAt: '2026-10-01T00:00:00Z', href: `/orders/${id}`,
});
const documents = [inv('INV-000083', 'c3', 'Rashida Modi', 21700), ord('ORD-000041', 'c3', 'Rashida Modi', 258250)];
const opts = { roster, documents };

const start = (raw: RawIntent) => {
  const d = newDraft(raw);
  return { d, r: readDraft(d, opts) };
};
const edit = (d: Draft, e: Parameters<typeof applyEdit>[1]) => {
  const next = applyEdit(d, e, readDraft(d, opts));
  return { d: next, r: readDraft(next, opts) };
};

describe('editing a reading', () => {
  it('leaves an unchanged reading exactly as resolveIntent made it', () => {
    const raw: RawIntent = { action: 'record_payout', summary: 'Paid Uzair Rs 5,000', person: { name: 'Uzair', kind: 'karigar' }, amount: 5000 };
    expect(start(raw).r).toEqual(resolveIntent(raw, opts));
  });

  it('a figure misheard is typed over, and the card says the new one', () => {
    let { d } = start({ action: 'record_payout', summary: 'Paid Uzair Rs 50,000', person: { name: 'Uzair', kind: 'karigar' }, amount: 50000 });
    const out = edit(d, { kind: 'amount', value: 5000 });
    expect(out.r.amount).toBe(5000);
    expect(out.r.summary).toBe('The shop paid Uzair Rs 5,000.');
    expect(out.r.postable).toBe(true);
    // Cleared by hand, it stays cleared — not recovered from the model's old "Rs 50,000".
    d = out.d;
    const cleared = edit(d, { kind: 'amount', value: null });
    expect(cleared.r.amount).toBeNull();
    expect(cleared.r.postable).toBe(false);
    expect(cleared.r.blockedBecause).toBe('No amount.');
  });

  it('"diye" heard as "liye": the direction is changed and the person and figure stay', () => {
    const { d } = start({ action: 'record_payment', summary: 'Uzair paid Rs 5,000', person: { name: 'Uzair', kind: 'karigar' }, amount: 5000 });
    const out = edit(d, { kind: 'action', action: 'record_payout' });
    expect(out.r.action).toBe('record_payout');
    expect(out.r.person?.id).toBe('k1');
    expect(out.r.amount).toBe(5000);
  });

  it('"which Alifya?" is answered on the card, and the answer is remembered as a correction', () => {
    const { d, r } = start({ action: 'record_owed', summary: 'Alifya owes Rs 2,000', person: { spoken_as: 'Alifya', name: 'Alifya' }, amount: 2000 });
    expect(r.ambiguous).toBe(true);
    const out = edit(d, { kind: 'person', person: { ...roster[1], score: 0.8, via: 'phonetic' } });
    expect(out.r.person?.id).toBe('c2');
    expect(out.r.postable).toBe(true);
    expect(out.d.personChosen).toBe(true);
  });

  it('a payment more than the invoice owes is still refused after editing', () => {
    const { d } = start({ action: 'invoice_payment', summary: 'Rashida paid Rs 20,000', person: { name: 'Rashida Modi', kind: 'customer' }, amount: 20000 });
    const out = edit(d, { kind: 'amount', value: 30000 });
    expect(out.r.doc?.id).toBe('INV-000083');
    expect(out.r.postable).toBe(false);
    expect(out.r.blockedBecause).toContain('Rs 21,700');
  });

  it('switching from a payment to an advance lets go of the invoice and finds her order', () => {
    const { d } = start({ action: 'invoice_payment', summary: 'Rashida paid Rs 20,000 by bank', person: { name: 'Rashida Modi', kind: 'customer' }, amount: 20000 });
    const out = edit(d, { kind: 'action', action: 'order_advance' });
    expect(out.r.doc?.id).toBe('ORD-000041');
    // How it was paid comes along: an advance carries its method too.
    expect(out.r.summary).toBe('Rs 20,000 advance by bank transfer on ORD-000041 (Rashida Modi).');
  });

  it('keeps the method read from the sentence once something else is changed', () => {
    const { d, r } = start({ action: 'invoice_payment', summary: 'Rashida paid Rs 20,000 by bank transfer', person: { name: 'Rashida Modi', kind: 'customer' }, amount: 20000 });
    expect(r.method).toBe('Bank Transfer');
    const out = edit(d, { kind: 'amount', value: 21700 });
    expect(out.r.method).toBe('Bank Transfer');
    expect(edit(out.d, { kind: 'field', key: 'method', value: 'Card' }).r.method).toBe('Card');
  });

  it('a karigar is let go when the entry becomes one only a customer can have', () => {
    const { d } = start({ action: 'record_payout', summary: 'Paid Uzair Rs 5,000', person: { name: 'Uzair', kind: 'karigar' }, amount: 5000 });
    const out = edit(d, { kind: 'action', action: 'invoice_payment' });
    expect(out.r.person).toBeNull();
    // With no name the only open invoice in the book is offered, and the card says whose it is.
    expect(out.r.summary).toBe('Rs 5,000 by cash against INV-000083 (Rashida Modi).');
  });

  it('what it could not place becomes an entry by hand', () => {
    const { d, r } = start({ action: 'unknown', summary: 'Not sure' });
    expect(r.postable).toBe(false);
    let s = edit(d, { kind: 'action', action: 'expense' });
    s = edit(s.d, { kind: 'amount', value: 1500 });
    s = edit(s.d, { kind: 'description', value: 'Tea and samosas' });
    expect(s.r.postable).toBe(true);
    expect(s.r.summary).toBe('An expense of Rs 1,500 — Tea and samosas.');
  });

  it("a new customer's details are added and taken away", () => {
    const { d } = start({ action: 'new_customer', summary: 'New customer Sara', fields: { name: 'Sara' } });
    let s = edit(d, { kind: 'field', key: 'phone', value: '0300 1234567' });
    expect(s.r.fields).toEqual({ name: 'Sara', phone: '0300 1234567' });
    s = edit(s.d, { kind: 'field', key: 'name', value: '' });
    expect(s.r.blockedBecause).toBe('No name given.');
  });
});

describe('describeReading', () => {
  it('says gold in grams and karat', () => {
    const r = resolveIntent({ action: 'gold_received', summary: '', person: { name: 'Uzair' }, grams: 12.5 }, opts);
    expect(describeReading(r)).toBe('12.5 g of 21k received from Uzair.');
  });
});
