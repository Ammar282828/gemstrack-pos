import { describe, it, expect } from 'vitest';
import { cashInForPeriod, invoicedOrderIds, paymentExchangePart, type Period } from './cash-in';
import { orderAdvancePayments } from '@/lib/order-payment';

const september: Period = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') };
const august: Period = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };

// An order placed in August with 50,000 cash and 30,000 of gold, and a second advance of
// 20,000 in September.
const order = {
  id: 'ORD-000123',
  status: 'In Progress' as const,
  createdAt: '2026-08-20T10:00:00.000Z',
  advancePayment: 70000,
  advances: [{ amount: 20000, date: '2026-09-10T12:00:00.000Z' }],
  exchanges: [{ description: 'Old 22k ring', value: 30000 }],
  advanceInExchangeValue: 30000,
};

const run = (period: Period, invoices: any[], orders: any[], extraRevenues: any[] = []) =>
  cashInForPeriod({ invoices, orders, invoiced: invoicedOrderIds(orders, invoices), extraRevenues, period });

describe('cashInForPeriod', () => {
  it('an open order: its cash advances on their own days, its gold as cash on the order day', () => {
    expect(run(august, [], [order])).toMatchObject({ orderAdvances: 50000, exchange: 30000, total: 80000, exchangeOffInvoices: 0 });
    expect(run(september, [], [order])).toMatchObject({ orderAdvances: 20000, exchange: 0, total: 20000 });
  });

  it('finalising the order moves nothing: its advances are counted once, on the invoice', () => {
    // As generateInvoiceFromOrder writes it since 2026-09-25.
    const invoice = {
      createdAt: '2026-09-15T09:00:00.000Z', sourceOrderId: order.id,
      paymentHistory: [...orderAdvancePayments(order), { amount: 25000, date: '2026-09-15T09:00:00.000Z' }],
      exchanges: order.exchanges, exchangeAmount1: 30000,
    };
    const finalised = { ...order, status: 'Completed' as const, invoiceId: 'INV-000900' };
    const cashIn = (period: Period) => cashInForPeriod({
      invoices: [invoice], orders: [finalised], invoiced: invoicedOrderIds([finalised], [invoice]), extraRevenues: [], period,
      invoiceDate: () => order.createdAt, // its revenue date, the order's
    });
    expect(cashIn(august)).toMatchObject({ invoicePayments: 50000, orderAdvances: 0, exchange: 30000, total: 80000, exchangeOffInvoices: 30000 });
    expect(cashIn(september)).toMatchObject({ invoicePayments: 45000, orderAdvances: 0, exchange: 0, total: 45000 });
  });

  it('an order only its invoice points to (older data) is not counted again', () => {
    const invoice = { createdAt: '2026-08-25T09:00:00.000Z', sourceOrderId: order.id, paymentHistory: [{ amount: 50000, date: order.createdAt }] };
    const unlinked = { ...order, advances: [], advancePayment: 50000, status: 'Completed' as const };
    expect(run(august, [invoice], [unlinked])).toMatchObject({ invoicePayments: 50000, orderAdvances: 0, total: 50000 });
  });

  it("an older invoice's lumped order advance counts whole, its gold under exchange", () => {
    const invoice = {
      createdAt: '2026-08-25T09:00:00.000Z', sourceOrderId: 'ORD-000050',
      paymentHistory: [
        { amount: 80000, date: '2026-08-02T10:00:00.000Z', notes: 'Advance from Order. Cash: 50000. Exchange: 30000 (Old 22k ring)' },
        { amount: 10000, date: '2026-08-25T09:00:00.000Z' },
      ],
    };
    expect(run(august, [invoice], [])).toMatchObject({ invoicePayments: 60000, exchange: 30000, total: 90000, exchangeOffInvoices: 0 });
  });

  it('gold taken at the counter is cash on the day of the sale', () => {
    const invoice = { createdAt: '2026-09-12T09:00:00.000Z', exchangeDescription: 'Old bangle', exchangeAmount1: 40000, paymentHistory: [{ amount: 60000, date: '2026-09-12T09:00:00.000Z' }] };
    expect(run(september, [invoice], [])).toMatchObject({ invoicePayments: 60000, exchange: 40000, total: 100000, exchangeOffInvoices: 40000 });
    expect(run(august, [invoice], []).total).toBe(0);
  });

  it('cancelled and refunded orders and refunded invoices bring no cash', () => {
    const invoice = { status: 'Refunded', createdAt: '2026-09-01T00:00:00.000Z', paymentHistory: [{ amount: 9000, date: '2026-09-02T00:00:00.000Z' }] };
    const cancelled = { ...order, id: 'ORD-1', status: 'Cancelled' as const };
    const refunded = { ...order, id: 'ORD-2', status: 'Refunded' as const };
    expect(run(september, [invoice], [cancelled, refunded]).total).toBe(0);
  });

  it('extra revenue in the period is cash; no period counts everything', () => {
    const extras = [{ date: '2026-09-05T00:00:00.000Z', amount: 4000 }, { date: '2026-08-05T00:00:00.000Z', amount: 1000 }];
    expect(run(september, [], [], extras)).toMatchObject({ extraRevenue: 4000, total: 4000 });
    expect(run({ from: null, to: null }, [], [order], extras)).toMatchObject({ orderAdvances: 70000, exchange: 30000, extraRevenue: 5000, total: 105000 });
  });
});

describe('paymentExchangePart', () => {
  it('reads the exchange out of an older order advance', () => {
    expect(paymentExchangePart({ amount: 80000, notes: 'Advance from Order. Cash: 50000. Exchange: 30000 (Old ring)' })).toBe(30000);
  });
  it('keeps its share when the amount was scaled for a coin on the bill', () => {
    expect(paymentExchangePart({ amount: 40000, notes: 'Advance from Order. Cash: 50000. Exchange: 30000 ()' })).toBe(15000);
  });
  it('a missing cash figure means it was all exchange', () => {
    expect(paymentExchangePart({ amount: 30000, notes: 'Advance from Order. Cash: undefined. Exchange: 30000 ()' })).toBe(30000);
  });
  it('anything else is all cash', () => {
    expect(paymentExchangePart({ amount: 50000, notes: 'Advance from Order. Cash: 50000. Exchange: 0 ()' })).toBe(0);
    expect(paymentExchangePart({ amount: 50000, notes: 'Advance payment from custom order.' })).toBe(0);
    expect(paymentExchangePart({ amount: 50000, notes: 'Advance on order ORD-000123' })).toBe(0);
    expect(paymentExchangePart({ amount: 50000 })).toBe(0);
  });
});
