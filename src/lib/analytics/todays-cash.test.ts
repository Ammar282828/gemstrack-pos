import { describe, expect, it } from 'vitest';
import { karachiDayPeriod, todaysCash } from './todays-cash';
import type { AdditionalRevenue, Expense, Invoice, Order, Repair } from '@/lib/store';

const now = new Date('2026-10-01T15:00:00Z'); // 20:00 in Karachi
const T = (hhmm: string) => `2026-10-01T${hhmm}:00+05:00`;

const invoices = [
  { id: 'INV-1', customerName: 'Sakina', status: 'Paid', createdAt: T('11:00'), grandTotal: 100_000, exchangeAmount1: 20_000, exchangeDescription: 'Old ring',
    paymentHistory: [{ amount: 60_000, date: T('11:05'), method: 'Cash' }, { amount: 20_000, date: T('11:06'), method: 'Card' }] },
  { id: 'INV-2', customerName: 'Walk-in Customer', status: 'Paid', createdAt: '2026-09-20T10:00:00+05:00', grandTotal: 50_000,
    paymentHistory: [{ amount: 50_000, date: '2026-09-30T23:30:00+05:00', method: 'Cash' }, { amount: 10_000, date: T('00:30'), method: 'Bank Transfer' }] },
  { id: 'INV-3', status: 'Refunded', createdAt: T('12:00'), paymentHistory: [{ amount: 9_999, date: T('12:00'), method: 'Cash' }] },
] as unknown as Invoice[];
const orders = [
  { id: 'ORD-1', customerName: 'Fatema', status: 'Pending', createdAt: T('13:00'), advancePayment: 15_000, advanceMethod: 'Cash' },
  { id: 'ORD-2', customerName: 'Old', status: 'Pending', createdAt: T('13:30'), advancePayment: 5_000, invoiceId: 'INV-9' },
] as unknown as Order[];
const repairs = [{ id: 'REP-1', customerName: 'Batul', payments: [{ amount: 2_000, date: T('14:00'), method: 'Card', revenueId: 'rev-1' }] }] as unknown as Repair[];
const extraRevenues = [
  { id: 'rev-1', date: T('14:00'), description: 'Repair REP-1', amount: 2_000, repairId: 'REP-1' },
  { id: 'rev-2', date: T('15:00'), description: 'Polish', amount: 1_000 },
] as AdditionalRevenue[];
const expenses = [
  { id: 'e1', date: T('16:00'), category: 'Tea', description: 'Tea', amount: 500 },
  { id: 'e2', date: T('16:30'), category: 'Other', description: 'Paid by Ammar', amount: 7_000, paidBy: 'ammar' },
  { id: 'e3', date: '2026-09-30T18:00:00+05:00', category: 'Tea', description: 'Yesterday', amount: 300 },
] as unknown as Expense[];

describe('today\'s cash', () => {
  const t = todaysCash({ invoices, orders, repairs, extraRevenues, expenses, now });
  it('is Karachi\'s day', () => {
    expect(t.day).toBe('2026-10-01');
    expect(karachiDayPeriod(new Date('2026-09-30T19:30:00Z')).day).toBe('2026-10-01'); // 00:30 in Karachi
  });
  it('takes money in by how it was paid: invoices, order advances, repairs, other extra revenue', () => {
    expect(t.byMethod).toEqual({ Cash: 75_000, Card: 22_000, 'Bank Transfer': 10_000, Cheque: 0, 'Not recorded': 1_000 });
    expect(t.totalIn).toBe(108_000);
    expect(t.lines.map(l => l.ref)).toEqual(['INV-2', 'INV-1', 'INV-1', 'ORD-1', 'REP-1', 'Polish']);
  });
  it('keeps exchange gold on its own line, never in cash', () => {
    expect(t.exchange).toBe(20_000);
    expect(t.byMethod.Cash).not.toBeGreaterThan(75_000);
  });
  it('the drawer is cash in less what the business paid today (never a partner\'s own money)', () => {
    expect(t.expenses).toBe(500);
    expect(t.netCash).toBe(74_500);
  });
});
