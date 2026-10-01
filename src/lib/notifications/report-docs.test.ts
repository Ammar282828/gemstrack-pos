import { describe, expect, it } from 'vitest';
import { checklistDoc, dailyReportDoc, givenDoc, karigarDoc, overdueDoc, weeklyDoc } from './report-docs';

// 9 pm in Karachi on Thursday 1 October 2026.
const now = new Date('2026-10-01T16:00:00Z');
const inv = (id: string, createdAt: string, value: number, balance = 0, extra = {}) => ({
  id, createdAt, customerName: 'Sara', subtotal: value, discountAmount: 0, grandTotal: value, amountPaid: value - balance, balanceDue: balance,
  items: [], paymentHistory: [{ amount: value - balance, date: createdAt, method: 'Cash' }], ...extra,
});

describe('dailyReportDoc', () => {
  it("counts Karachi's day: a sale at half past midnight is today's, one at 11 pm the night before is not", () => {
    const d = dailyReportDoc({
      invoices: [
        inv('INV-1', '2026-09-30T19:30:00Z', 100000), // 00:30 on the 1st in Karachi
        inv('INV-2', '2026-09-30T18:00:00Z', 50000),  // 23:00 on the 30th
        inv('INV-3', '2026-10-01T10:00:00Z', 20000, 5000),
      ],
      orders: [], expenses: [{ id: 'e', date: '2026-10-01T08:00:00Z', amount: 3000, category: 'Food', description: 'Lunch' }],
    }, now);
    expect(d.heading).toBe('Thursday 1 October 2026');
    const sales = d.sections.find(s => s.title === 'Sales today')!.table!;
    expect(sales.rows.map(r => r[0])).toEqual(['INV-1', 'INV-3']);
    expect(sales.tones).toEqual([undefined, 'flag']);
    expect(d.figures?.[0]).toMatchObject({ label: 'Sales', value: 'PKR 120,000', note: '2 invoices' });
    expect(d.figures?.[1]).toMatchObject({ label: 'Money in', value: 'PKR 115,000' });
    expect(d.figures?.[3]).toMatchObject({ label: 'Net cash', value: 'PKR 112,000' });
    expect(d.sections.find(s => s.title === 'Every payment today')!.table!.rows).toHaveLength(2);
    expect(d.sections.find(s => s.title === 'Paid out today')!.table!.rows).toEqual([['Lunch', 'Food', '3,000']]);
  });
});

describe('checklistDoc', () => {
  it('flags orders a week past their promise and lists what is coming up', () => {
    const d = checklistDoc({
      orders: [
        { id: 'ORD-1', status: 'Pending', createdAt: '2026-09-01T00:00:00Z', promisedDate: '2026-09-20', grandTotal: 1000, customerName: 'A' },
        { id: 'ORD-2', status: 'In Progress', createdAt: '2026-09-25T00:00:00Z', promisedDate: '2026-09-29', grandTotal: 2000, customerName: 'B' },
        { id: 'ORD-3', status: 'Pending', createdAt: '2026-09-30T00:00:00Z', promisedDate: '2026-10-10', grandTotal: 3000, customerName: 'C' },
        { id: 'ORD-4', status: 'Completed', createdAt: '2026-09-01T00:00:00Z', promisedDate: '2026-09-02' },
      ],
      invoices: [], expenses: [],
      given: [{ id: 'g', status: 'out', date: '2026-09-10T00:00:00Z', description: 'Ring for sizing', recipientName: 'Uzair' }],
      karigars: [{ name: 'Uzair', cash: -12000, gold: 0 }],
    }, now);
    expect(d.figures?.[0]).toMatchObject({ label: 'Active orders', value: '3' });
    expect(d.figures?.[1]).toMatchObject({ label: 'Past their date', value: '2', tone: 'flag' });
    const lateT = d.sections[0].table!;
    expect(lateT.rows.map(r => r[0])).toEqual(['ORD-1', 'ORD-2']);
    expect(lateT.tones).toEqual(['flag', undefined]);
    expect(d.sections[1].table!.rows.map(r => r[0])).toEqual(['ORD-3']);
    expect(d.sections.find(s => s.title === 'Given out over a week')!.table!.rows[0]).toEqual(['Ring for sizing', 'Uzair', '10 Sept', '21']);
    expect(d.figures?.[3]).toMatchObject({ value: 'PKR 12,000' });
  });
});

describe('weeklyDoc', () => {
  it('has a row for each of the seven days, ending today', () => {
    const d = weeklyDoc({ invoices: [inv('INV-1', '2026-09-30T19:30:00Z', 100000), inv('INV-0', '2026-09-24T12:00:00Z', 9)], orders: [], expenses: [] }, now);
    const t = d.sections[0].table!;
    expect(t.rows).toHaveLength(7);
    expect(t.rows[0][0]).toBe('Fri 25 Sept');
    expect(t.rows[6]).toEqual(['Thu 1 Oct', '1', '100,000', '0']);
    expect(t.foot).toEqual(['Week', '1', '100,000', '0']);
  });
});

describe('the checks', () => {
  it('are quiet when there is nothing to say', () => {
    expect(overdueDoc([{ id: 'ORD-1', status: 'Pending', createdAt: '2026-09-30T00:00:00Z', promisedDate: '2026-10-09' }], now)).toBeNull();
    expect(givenDoc([{ status: 'out', date: '2026-09-29T00:00:00Z' }], now)).toBeNull();
    expect(karigarDoc([], now)).toBeNull();
  });
  it('name the count in the file', () => {
    const d = overdueDoc([{ id: 'ORD-1', status: 'Pending', createdAt: '2026-09-01T00:00:00Z', promisedDate: '2026-09-20', grandTotal: 5000 }], now)!;
    expect(d.headline).toBe('1 Oct · 1 order late · 1 a week or more');
  });
});
