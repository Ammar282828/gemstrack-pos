import { describe, expect, it } from 'vitest';
import { widgetSummary, type WidgetRows } from './summary';

// 2026-10-08 15:00 in Karachi.
const now = new Date('2026-10-08T10:00:00Z');

const rows = (over: Partial<WidgetRows> = {}): WidgetRows => ({
  invoices: [
    { id: 'INV-1', status: 'Paid', grandTotal: 50_000, amountPaid: 50_000, balanceDue: 0, createdAt: '2026-10-08T06:00:00Z',
      paymentHistory: [{ amount: 50_000, date: '2026-10-08T06:00:00Z', method: 'Cash' }] },
    { id: 'INV-2', status: 'Unpaid', grandTotal: 250_000, amountPaid: 0, balanceDue: 250_000, customerId: 'C1', customerName: 'Ali', createdAt: '2026-09-01T06:00:00Z', paymentHistory: [] },
  ] as unknown as WidgetRows['invoices'],
  orders: [
    { id: 'ORD-1', status: 'In Progress', promisedDate: '2026-10-08', createdAt: '2026-10-01T06:00:00Z' },
    { id: 'ORD-2', status: 'Pending', promisedDate: '2026-10-02', createdAt: '2026-09-20T06:00:00Z' },
    { id: 'ORD-3', status: 'Completed', promisedDate: '2026-10-01', createdAt: '2026-09-20T06:00:00Z' },
    { id: 'ORD-4', status: 'Pending', promisedDate: '2026-10-08', createdAt: '2026-10-07T06:00:00Z', website: { paymentStatus: 'awaiting_transfer' } },
  ] as unknown as WidgetRows['orders'],
  repairs: [],
  extraRevenues: [],
  expenses: [{ id: 'E1', date: '2026-10-08T07:00:00Z', amount: 5_000, description: 'Tea', category: 'Other' }] as unknown as WidgetRows['expenses'],
  hisaab: [],
  rates: { goldRatePerGram21k: 24_350.4, silverRatePerGram: 410, updatedAt: '2026-10-08T04:40:00Z' },
  ...over,
});

describe('the widget\'s four figures', () => {
  it('reads like the ERP\'s own pages', () => {
    const s = widgetSummary(rows(), 'Taheri', 'gold', now);
    expect(s.house).toBe('Taheri');
    expect(s.updated).toBe('3:00 pm');
    const [rate, drawer, owed, due] = s.figures;
    expect(rate).toEqual({ label: 'Gold 21K', value: 'Rs 24,350', detail: expect.stringMatching(/^a gram · /) });
    expect(drawer).toEqual({ label: 'In the drawer', value: 'Rs 45,000', detail: 'Rs 50,000 in today' });
    expect(owed).toEqual({ label: 'Owed to you', value: 'Rs 2.5 lac', detail: '1 unpaid' });
    // ORD-1 today, ORD-2 late; the finished one and the unpaid online one are not counted.
    expect(due).toEqual({ label: 'Due', value: '2', detail: '1 late' });
  });

  it('says when the rate was not set today, and shows silver for a silver house', () => {
    const s = widgetSummary(rows({ rates: { silverRatePerGram: 410, updatedAt: '2026-10-06T04:40:00Z' } }), 'House of Mina', 'silver', now);
    expect(s.figures[0]).toEqual({ label: 'Silver', value: 'Rs 410', detail: 'not set today' });
  });
});
