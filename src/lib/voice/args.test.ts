import { describe, expect, it } from 'vitest';
import { parseDate, parseNumber, resolveArg, type Book } from './args';

const book = (over: Partial<Book> = {}): Book => ({
  roster: [
    { id: 'c1', name: 'Rashida Modi', kind: 'customer' },
    { id: 'c2', name: 'Alifya Burhanuddin', kind: 'customer' },
    { id: 'c3', name: 'Alifya Saifee', kind: 'customer' },
    { id: 'k1', name: 'Uzair', kind: 'karigar' },
  ],
  aliases: new Map(), customers: [], karigars: [],
  orders: [
    { id: 'ORD-000041', customerId: 'c1', customerName: 'Rashida Modi', status: 'Pending', items: [{}], createdAt: '2026-09-30' },
    { id: 'ORD-000042', customerId: 'c2', customerName: 'Alifya Burhanuddin', status: 'In Progress', items: [{}], createdAt: '2026-09-29' },
    { id: 'ORD-000043', customerId: 'c3', customerName: 'Alifya Saifee', status: 'Pending', items: [{}], createdAt: '2026-09-28' },
    { id: 'ORD-000030', customerId: 'c1', customerName: 'Rashida Modi', status: 'Completed', invoiceId: 'INV-000080', items: [{}], createdAt: '2026-09-01' },
  ] as never,
  invoices: [], repairs: [],
  products: [
    { sku: 'RIN-000123', name: 'Ruby ring', metalWeightG: 4.2, karat: '21k' },
    { sku: 'BAN-000123', name: 'Plain bangle', metalWeightG: 20, karat: '21k' },
    { sku: 'CHN-000007', name: 'Rope chain', metalWeightG: 12, karat: '22k' },
  ] as never,
  givenItems: [], karigarJobs: [], expenses: [], extraRevenues: [],
  destinations: [
    { label: 'Analytics', href: '/analytics', keywords: ['reports'] },
    { label: 'Today’s cash', href: '/today', keywords: ['cash', 'drawer', 'till'] },
    { label: 'Orders', href: '/orders', keywords: ['custom order'] },
  ],
  today: '2026-10-01',
  ...over,
});

describe('numbers and dates', () => {
  it('reads figures as the shop says them', () => {
    expect(parseNumber('34,000')).toBe(34000);
    expect(parseNumber('Rs 34000')).toBe(34000);
    expect(parseNumber('34k')).toBe(34000);
    expect(parseNumber('2.5 lakh')).toBe(250000);
    expect(parseNumber('4.5 g')).toBe(4.5);
    expect(parseNumber('kuch')).toBeNull();
  });
  it('reads days against Karachi’s today; "kal" looks ahead', () => {
    expect(parseDate('kal', '2026-10-01')).toBe('2026-10-02');
    expect(parseDate('parso', '2026-10-01')).toBe('2026-10-03');
    expect(parseDate('10 din mein', '2026-10-01')).toBe('2026-10-11');
    expect(parseDate('2026-10-05', '2026-10-01')).toBe('2026-10-05');
  });
});

describe('resolveArg', () => {
  it('pins a person by name, and asks between two Alifyas', () => {
    expect(resolveArg({ name: 'c', type: 'customer', label: 'C' }, 'Rashida Modi', book())).toMatchObject({ ok: true, label: 'Rashida Modi' });
    const two = resolveArg({ name: 'c', type: 'customer', label: 'C' }, 'Alifya', book());
    expect(two?.ok).toBe(false);
    expect(two && !two.ok && two.candidates.map(c => c.label)).toEqual(expect.arrayContaining(['Alifya Burhanuddin', 'Alifya Saifee']));
  });
  it('keeps a karigar off the customer side', () => {
    const r = resolveArg({ name: 'c', type: 'customer', label: 'C' }, 'Uzair', book());
    expect(r?.ok).toBe(false);
  });
  it('an order by its number, or by whose it is (the open one)', () => {
    expect(resolveArg({ name: 'o', type: 'order', label: 'O' }, '41', book())).toMatchObject({ ok: true, label: 'ORD-000041' });
    expect(resolveArg({ name: 'o', type: 'order', label: 'O', open: true }, 'Rashida', book())).toMatchObject({ ok: true, label: 'ORD-000041' });
    expect(resolveArg({ name: 'o', type: 'order', label: 'O', open: true }, '30', book())).toMatchObject({ ok: false, reason: 'ORD-000030 is closed.' });
  });
  it('a name that is two people offers their orders, not the people', () => {
    const r = resolveArg({ name: 'o', type: 'order', label: 'O', open: true }, 'Alifya', book());
    expect(r && !r.ok && r.candidates.map(c => c.label)).toEqual(['ORD-000042', 'ORD-000043']);
  });
  it('a piece by its tag, by its number when only one has it, by its words', () => {
    expect(resolveArg({ name: 'p', type: 'product', label: 'P' }, 'rin-000123', book())).toMatchObject({ ok: true, label: 'RIN-000123' });
    expect(resolveArg({ name: 'p', type: 'product', label: 'P' }, '7', book())).toMatchObject({ ok: true, label: 'CHN-000007' });
    const two = resolveArg({ name: 'p', type: 'product', label: 'P' }, '123', book());
    expect(two && !two.ok && two.candidates.length).toBe(2);
    expect(resolveArg({ name: 'p', type: 'product', label: 'P' }, 'rope chain', book())).toMatchObject({ ok: true, label: 'CHN-000007' });
  });
  it('a screen by its name or its other words', () => {
    expect(resolveArg({ name: 's', type: 'screen', label: 'S' }, 'analytics', book())).toMatchObject({ ok: true, value: '/analytics' });
    expect(resolveArg({ name: 's', type: 'screen', label: 'S' }, 'the drawer', book())).toMatchObject({ ok: true, value: '/today' });
  });
  it('"$2" stands for what step 2 made', () => {
    expect(resolveArg({ name: 'c', type: 'customer', label: 'C' }, '$2', book())).toMatchObject({ ok: true, ref: 2 });
  });
  it('an option by its other words', () => {
    const spec = { name: 's', type: 'enum' as const, label: 'S', options: ['received', 'ready', 'collected'], synonyms: { taiyar: 'ready' } };
    expect(resolveArg(spec, 'taiyar hai', book())).toMatchObject({ ok: true, value: 'ready' });
  });
});
