import { describe, expect, it } from 'vitest';
import { revenueForPeriod, coinRevenueForPeriod } from './revenue-period';
import { splitAllCoinSales, summariseCoins } from './coins';
import { invoiceSaleValue } from './sale-value';
import type { AdditionalRevenue, Invoice, Order } from '@/lib/store';

const from = new Date('2026-10-01T00:00:00+05:00');
const to = new Date('2026-11-01T00:00:00+05:00');
const invoice = (over: object): Invoice => ({ id: 'INV-test', status: 'Paid', grandTotal: 100, createdAt: '2026-10-08', ...over } as unknown as Invoice);
const order = (over: object): Order => ({ id: 'ORD-test', status: 'Pending', subtotal: 100, createdAt: '2026-10-08', ...over } as Order);
const extra = (amount: number, date: string): AdditionalRevenue => ({ id: 'EX-test', amount, date } as AdditionalRevenue);

describe('dashboard and widget revenue', () => {
  it('recognises source orders on their original date without counting the invoiced order twice', () => {
    const orders = [order({ id: 'old', invoiceId: 'INV-old', createdAt: '2026-09-30', subtotal: 200 }), order({ id: 'new', invoiceId: 'INV-new', subtotal: 300 }), order({ id: 'open', subtotal: 400 })];
    const invoices = [invoice({ id: 'INV-old', sourceOrderId: 'old', grandTotal: 200 }), invoice({ id: 'INV-new', sourceOrderId: 'new', grandTotal: 300, createdAt: '2026-11-02' })];
    expect(revenueForPeriod({ invoices, orders, extraRevenues: [] }, from, to)).toBe(700);
  });

  it('includes gold exchanged as payment, open sales and other income; excludes refunds, cancellations and unconfirmed transfers', () => {
    const invoices = [invoice({ grandTotal: 60, exchanges: [{ description: 'Old ring', value: 40 }] }), invoice({ status: 'Refunded', grandTotal: 999 })];
    const orders = [order({ subtotal: 200 }), order({ status: 'Cancelled', subtotal: 999 }), order({ status: 'Refunded', subtotal: 999 }), order({ website: { paymentStatus: 'awaiting_transfer' }, subtotal: 999 }), order({ website: { paymentStatus: 'slip_sent' }, subtotal: 999 })];
    expect(revenueForPeriod({ invoices, orders, extraRevenues: [extra(50, '2026-10-08')] }, from, to)).toBe(350);
  });

  it('uses Karachi day and month boundaries, including bare dates, with an exclusive end', () => {
    const extraRevenues = [extra(100, '2026-09-30T18:59:59.999Z'), extra(200, '2026-09-30T19:00:00.000Z'), extra(300, '2026-10-01'), extra(400, '2026-10-31T18:59:59.999Z'), extra(500, '2026-10-31T19:00:00.000Z'), extra(999, 'invalid')];
    const rows = { invoices: [], orders: [], extraRevenues };
    expect(revenueForPeriod(rows, from, to)).toBe(900);
    expect(revenueForPeriod(rows, from, new Date('2026-10-02T00:00:00+05:00'))).toBe(500);
  });

  describe('gold coins are apart, as in Analytics', () => {
    const line = (categoryId: string, itemTotal: number) => ({ categoryId, itemTotal, quantity: 1 });
    const coinInv = invoice({ id: 'INV-coin', grandTotal: 1000, subtotal: 1000, items: [line('cat017', 1000)] });
    const ringInv = invoice({ id: 'INV-ring', grandTotal: 500, subtotal: 500, items: [line('cat001', 500)] });
    const mixed = invoice({ id: 'INV-mix', grandTotal: 400, subtotal: 400, amountPaid: 400, items: [line('cat017', 100), line('cat001', 300)] });
    const rows = { invoices: [coinInv, ringInv, mixed], orders: [], extraRevenues: [extra(50, '2026-10-08')] };

    it('leaves a coin invoice out of the month and reports it in the coin line', () => {
      expect(revenueForPeriod(rows, from, to)).toBe(500 + 300 + 50);
      expect(coinRevenueForPeriod(rows, from, to)).toBe(1000 + 100);
    });

    it('equals what Analytics counts (jewellery split, then invoice sale value) on a mixed fixture', () => {
      const { jewellery, coins } = splitAllCoinSales(rows.invoices);
      const analytics = jewellery.reduce((s, i) => s + invoiceSaleValue(i), 0) + 50;
      expect(revenueForPeriod(rows, from, to)).toBe(analytics);
      expect(coinRevenueForPeriod(rows, from, to)).toBe(summariseCoins(coins).revenue);
    });

    it('shows no coin line when none were sold, and ignores refunded coins', () => {
      expect(coinRevenueForPeriod({ invoices: [ringInv], orders: [] }, from, to)).toBe(0);
      expect(coinRevenueForPeriod({ invoices: [{ ...coinInv, status: 'Refunded' } as Invoice], orders: [] }, from, to)).toBe(0);
    });

    it('counts an invoice with no createdAt nowhere, like Analytics', () => {
      expect(revenueForPeriod({ invoices: [invoice({ createdAt: '' })], orders: [], extraRevenues: [] }, from, to)).toBe(0);
    });
  });
});
