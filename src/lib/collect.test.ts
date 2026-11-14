import { describe, expect, it } from 'vitest';
import { byTakenBy, collectRows, sortRows } from './collect';

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
