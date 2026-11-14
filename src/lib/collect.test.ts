import { describe, expect, it } from 'vitest';
import { byTakenBy, collectRows, countBy, filterRows, NO_FILTERS, sortRows, type CollectFilters } from './collect';

const inv = (o: Record<string, unknown>) => ({ id: 'I', customerName: 'A', createdAt: '2026-11-01', balanceDue: 0, grandTotal: 100, subtotal: 100, items: [], paymentHistory: [], ...o }) as never;
const ord = (o: Record<string, unknown>) => ({ id: 'O', customerName: 'B', createdAt: '2026-10-01', status: 'Completed', grandTotal: 0, subtotal: 500, advancePayment: 0, items: [], ...o }) as never;

describe('who still owes', () => {
  const rows = collectRows(
    [inv({ id: 'I1', balanceDue: 3000, takenBy: 'Mansoor' }), inv({ id: 'I2', balanceDue: 0 }), inv({ id: 'I3', balanceDue: 900, status: 'Refunded' }), inv({ id: 'I4', balanceDue: 7000, takenBy: 'Murtaza', createdAt: '2026-09-01' })],
    [ord({ id: 'O1', grandTotal: 2000, takenBy: 'Mansoor' }), ord({ id: 'O2', grandTotal: 2000, invoiceId: 'I1' }), ord({ id: 'O3', grandTotal: 2000, status: 'In Progress' })],
  );
  it('takes owing invoices and completed, uninvoiced orders with a balance — nothing paid, refunded, invoiced or unfinished', () => {
    expect(rows.map(r => r.id).sort()).toEqual(['I1', 'I4', 'O1']);
  });
  it('sorts by who took them, oldest first within each', () => {
    expect(sortRows(rows, 'takenBy').map(r => r.id)).toEqual(['O1', 'I1', 'I4']);
    expect(sortRows(rows, 'amount')[0].id).toBe('I4');
  });
  it('totals each person', () => {
    expect(byTakenBy(rows)).toEqual([{ takenBy: 'Murtaza', count: 1, due: 7000 }, { takenBy: 'Mansoor', count: 2, due: 5000 }]);
  });
});

describe('several filters at once', () => {
  const now = new Date('2026-11-14').getTime();
  const rows = collectRows(
    [inv({ id: 'I1', balanceDue: 3000, grandTotal: 5000, subtotal: 5000, takenBy: 'Mansoor', createdAt: '2026-11-10', customerContact: '0300 1234567' }),
     inv({ id: 'I4', balanceDue: 100, grandTotal: 100, subtotal: 100, takenBy: 'Murtaza', createdAt: '2026-07-01' })],
    [ord({ id: 'O1', grandTotal: 2000, subtotal: 3000, advancePayment: 1000, takenBy: 'Mansoor', createdAt: '2026-09-01', customerName: 'Sana' }),
     ord({ id: 'O9', grandTotal: 400, takenBy: 'Fatema', createdAt: '2026-11-01' })],
  );
  const f = (o: Partial<CollectFilters>): CollectFilters => ({ ...NO_FILTERS, ...o });
  it('ORs within a group and ANDs across them', () => {
    expect(filterRows(rows, f({ people: new Set(['Mansoor', 'Murtaza']) }), now).map(r => r.id).sort()).toEqual(['I1', 'I4', 'O1']);
    expect(filterRows(rows, f({ people: new Set(['Mansoor', 'Murtaza']), kinds: new Set(['invoice']) }), now).map(r => r.id).sort()).toEqual(['I1', 'I4']);
    expect(filterRows(rows, f({ people: new Set(['Mansoor']), ages: new Set(['30to90', 'over90']) }), now).map(r => r.id)).toEqual(['O1']);
  });
  it('knows age, nothing paid and a search by name, number or bill', () => {
    expect(filterRows(rows, f({ ages: new Set(['over90']) }), now).map(r => r.id)).toEqual(['I4']);
    expect(filterRows(rows, f({ paid: new Set(['nothing']) }), now).map(r => r.id)).toEqual(['I4']);
    expect(filterRows(rows, f({ query: 'sana' }), now).map(r => r.id)).toEqual(['O1']);
    expect(filterRows(rows, f({ query: '1234567' }), now).map(r => r.id)).toEqual(['I1']);
    expect(filterRows(rows, f({ query: 'o9' }), now).map(r => r.id)).toEqual(['O9']);
  });
  it('counts each chip with the other groups on', () => {
    const c = countBy(rows, f({ people: new Set(['Fatema']), kinds: new Set(['invoice']) }), 'people', r => r.takenBy, now);
    expect(c.get('Mansoor')?.count).toBe(1);
    expect(c.has('Fatema')).toBe(false);
  });
});
