import { describe, expect, it } from 'vitest';
import { codOwed, deliverToFromNotes, prefillBooking } from './tcs-booking';

describe('prefillBooking', () => {
  const order = {
    id: 'SHOPIFY-1460', customerName: 'Ayesha Khan', customerContact: '+923001234567', grandTotal: 12500,
    notes: 'Shopify order #1460 · Deliver to: House 12, Street 4, Lahore', shopifyOrderId: '555', shopifyOrderName: '#1460',
  };
  it('takes Shopify’s shipping address first', () => {
    const p = prefillBooking(order, 'order', { name: 'Ayesha K', address1: 'House 12', address2: 'Street 4, DHA', city: 'Lahore', phone: '0300 7654321' }, 'a@b.pk');
    expect(p).toEqual({
      consignee: { name: 'Ayesha K', address: 'House 12, Street 4, DHA', mobile: '03007654321', email: 'a@b.pk' },
      destinationCity: 'Lahore', codAmount: 12500, weight: 0.5, pieces: 1, reference: '#1460', productDetails: 'Jewellery', shopifyOrderId: '555',
    });
  });
  it('else the notes the import wrote, and the order’s own number', () => {
    const p = prefillBooking(order, 'order', null);
    expect(p.consignee).toEqual({ name: 'Ayesha Khan', address: 'House 12, Street 4', mobile: '03001234567', email: '' });
    expect(p.destinationCity).toBe('Lahore');
  });
  it('else the delivery block', () => {
    const p = prefillBooking({ id: 'ORD-1', customerName: 'Sara', grandTotal: 0, delivery: { address: '5 Main Rd', city: 'Multan', contactName: 'Hina', contactPhone: '03211234567' } }, 'order');
    expect(p).toMatchObject({ consignee: { name: 'Hina', address: '5 Main Rd', mobile: '03211234567' }, destinationCity: 'Multan', codAmount: 0, reference: 'ORD-1' });
    expect(p.shopifyOrderId).toBeUndefined();
  });
});

describe('codOwed', () => {
  it('is the balance: grandTotal on an order, balanceDue on an invoice; 0 once paid', () => {
    expect(codOwed({ id: 'o', grandTotal: 12499.6 }, 'order')).toBe(12500);
    expect(codOwed({ id: 'i', grandTotal: 20000, balanceDue: 5000 }, 'invoice')).toBe(5000);
    expect(codOwed({ id: 'o', grandTotal: 12500, shopifyFinancialStatus: 'paid' }, 'order')).toBe(0);
    expect(codOwed({ id: 'o', grandTotal: -10 }, 'order')).toBe(0);
  });
});

it('reads "Deliver to:" out of the notes', () => {
  expect(deliverToFromNotes('Shopify order #1 · Deliver to: Flat 3, Block B, Karachi')).toEqual({ address: 'Flat 3, Block B', city: 'Karachi' });
  expect(deliverToFromNotes('nothing')).toBeNull();
});
