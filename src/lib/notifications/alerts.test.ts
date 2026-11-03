import { describe, expect, it } from 'vitest';
import type { Invoice, Order } from '@/lib/store';
import { orderDoc, paymentDoc, saleDoc, textDoc, websiteOrderDoc } from './alerts';

const now = new Date('2026-10-01T10:00:00Z');

const invoice = {
  id: 'INV-000083', customerName: 'Rashida Modi', customerContact: '0300 1234567', takenBy: 'Huzaifa',
  createdAt: '2026-10-01T09:55:00Z', subtotal: 321720, discountAmount: 20, grandTotal: 321700, amountPaid: 300000, balanceDue: 21700,
  items: [{ sku: 'R-1', name: 'Bridal ring', karat: '21k', metalType: 'gold', metalWeightG: 9.462, itemTotal: 321720, size: '12', stoneDetails: 'ruby' }],
  paymentHistory: [{ amount: 300000, date: '2026-10-01T09:55:00Z', method: 'Cash' }],
} as unknown as Invoice;

describe('saleDoc', () => {
  it('is the sale: the pieces, the bill, the payments, and the balance flagged', () => {
    const d = saleDoc(invoice, now);
    expect(d.title).toBe('New sale');
    expect(d.headline).toBe('INV-000083 · Rashida Modi · PKR 321,700');
    expect(d.subheading).toContain('0300 1234567');
    expect(d.subheading).toContain('by Huzaifa');
    expect(d.figures?.[1]).toMatchObject({ label: 'Balance', value: 'PKR 21,700', tone: 'flag' });
    const pieces = d.sections.find(s => s.title === 'Pieces')!.table!;
    expect(pieces.rows).toEqual([['Bridal ring', '21K · 9.46 g', '321,720']]);
    expect(pieces.details).toEqual(['size 12 · ruby']);
    const bill = d.sections.find(s => s.title === 'The bill')!.pairs!;
    expect(bill.map(p => [p.label, p.value])).toEqual([
      ['Pieces', '321,720'], ['Discount', '- 20'], ['Total', 'PKR 321,700'], ['Paid', '300,000'], ['Balance', 'PKR 21,700'],
    ]);
  });
  it('a walk-in paid in full says so', () => {
    const d = saleDoc({ ...invoice, customerName: '', amountPaid: 321700, balanceDue: 0 } as Invoice, now);
    expect(d.headline).toBe('INV-000083 · Walk-in · PKR 321,700');
    expect(d.figures?.[1]).toMatchObject({ label: 'Paid', note: 'in full' });
  });
  it('reads items saved as a map, as some old invoices are', () => {
    const d = saleDoc({ ...invoice, items: { a: invoice.items[0] } as never }, now);
    expect(d.sections[0].table!.rows).toHaveLength(1);
  });
});

describe('paymentDoc', () => {
  it('names the payment that came in and marks it in the history', () => {
    const inv = { ...invoice, amountPaid: 321700, balanceDue: 0, paymentHistory: [...invoice.paymentHistory, { amount: 21700, date: '2026-10-02T08:00:00Z', method: 'Bank Transfer', reference: 'MZ-77' }] } as Invoice;
    const d = paymentDoc(inv, 1, now);
    expect(d.heading).toBe('PKR 21,700');
    expect(d.headline).toBe('INV-000083 · Rashida Modi · PKR 21,700');
    expect(d.figures?.[0]).toMatchObject({ label: 'Received', note: 'Bank Transfer · ref MZ-77' });
    expect(d.figures?.[1]).toMatchObject({ label: 'Balance', value: 'Paid in full' });
    const t = d.sections[0].table!;
    expect(t.details?.[1]).toBe('this payment · ref MZ-77');
    expect(t.foot).toEqual(['', '2 payments', '321,700']);
  });
});

const order = {
  id: 'ORD-000041', customerName: 'Fatima Saiger', createdAt: '2026-09-20T07:00:00Z', promisedDate: '2026-10-05', status: 'Pending', takenBy: 'Ammar',
  subtotal: 288250, advancePayment: 30000, grandTotal: 258250, advanceMethod: 'Cash',
  items: [{ description: 'Kada pair', karat: '21k', metalType: 'gold', estimatedWeightG: 20, totalEstimate: 288250, isCompleted: false, sampleGiven: false, hasStones: false, hasDiamonds: false, stoneWeightG: 0, wastagePercentage: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0 }],
} as unknown as Order;

describe('saleDoc with exchange gold', () => {
  it('states the full sale, not what is left after the exchange', () => {
    const inv = { id: 'INV-9', customerName: 'Sara', createdAt: '2026-10-01T09:55:00Z', subtotal: 500000, discountAmount: 0, grandTotal: 350000, exchanges: [{ description: 'old chain', value: 150000 }], amountPaid: 350000, balanceDue: 0, items: [] } as unknown as Invoice;
    const d = saleDoc(inv, now);
    expect(d.headline).toBe('INV-9 · Sara · PKR 500,000');
    expect(d.figures?.[0]).toMatchObject({ label: 'Total', value: 'PKR 500,000' });
    const pairs = d.sections.find(s => s.title === 'The bill')!.pairs!.map(p => [p.label, p.value]);
    expect(pairs.slice(0, 3)).toEqual([['Pieces', '500,000'], ['Total', 'PKR 500,000'], ['Exchange: old chain', '150,000']]);
  });
});

describe('orderDoc', () => {
  it('a new order: the estimate, the advance, the promised date', () => {
    const d = orderDoc(order, 'new', now);
    expect(d.title).toBe('New order');
    expect(d.subheading).toContain('promised 5 Oct');
    expect(d.figures?.map(f => [f.label, f.value])).toEqual([['Total', 'PKR 288,250'], ['Advance', 'PKR 30,000']]);
    expect(d.sections.find(s => s.title === 'Money')!.pairs!.at(-1)).toMatchObject({ label: 'Balance', value: 'PKR 258,250' });
    expect(d.sections.find(s => s.title === 'Advances')!.table!.rows).toEqual([['20 Sept', 'Cash', '30,000']]);
  });
  it('states the full amount (less discount only) in the headline and Money, the advance on its own line', () => {
    const d = orderDoc({ ...order, discountAmount: 8250, grandTotal: 250000 } as Order, 'new', now);
    expect(d.headline).toBe('ORD-000041 · Fatima Saiger · PKR 280,000');
    expect(d.figures?.[0]).toMatchObject({ label: 'Total', value: 'PKR 280,000' });
    const pairs = d.sections.find(s => s.title === 'Money')!.pairs!.map(p => [p.label, p.value]);
    expect(pairs).toEqual([['Estimate', '288,250'], ['Discount', '- 8,250'], ['Total', 'PKR 280,000'], ['Advance paid', '30,000'], ['Balance', 'PKR 250,000']]);
  });
  it('a cancelled order flags what was still owed on it', () => {
    const d = orderDoc({ ...order, status: 'Cancelled' } as Order, 'Cancelled', now);
    expect(d.title).toBe('Order cancelled');
    expect(d.figures?.[1]).toMatchObject({ label: 'Balance', tone: 'flag' });
  });
});

describe('websiteOrderDoc', () => {
  it('lists the pieces and says it waits to be confirmed', () => {
    const d = websiteOrderDoc({ id: 'ONL-7KQ4M2', customerName: 'Sara', customerPhone: '0301', city: 'Lahore', lines: [{ description: 'Studs', price: 45000 }], subtotal: 45000, deliveryCharge: 0, grandTotal: 45000, statusUrl: 'https://taheri.shop/o/x' }, now);
    expect(d.headline).toBe('ONL-7KQ4M2 · Sara · PKR 45,000 · to confirm');
    expect(d.figures?.[0].note).toBe('confirm it before anything else');
    expect(d.footnote).toContain('https://taheri.shop/o/x');
  });
});

describe('textDoc', () => {
  it('turns WhatsApp-formatted words into a heading and sections', () => {
    const d = textDoc({ kind: 'gold', title: 'Gold update', headline: '1 Oct', text: '📊 *GOLD RATE UPDATE — 1 Oct*\n━━━━━━━━\n\n💰 *TODAY\'S PRICES*\nSpot: $2,650\n- 24k: Rs 280,000\n\n*OUTLOOK*\n_Steady_ into the week.' }, now);
    expect(d.heading).toBe('GOLD RATE UPDATE — 1 Oct');
    expect(d.sections.map(s => [s.title, s.text])).toEqual([
      ["TODAY'S PRICES", ['Spot: $2,650', '• 24k: Rs 280,000']],
      ['OUTLOOK', ['Steady into the week.']],
    ]);
  });
});
