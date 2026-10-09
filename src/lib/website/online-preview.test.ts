import { describe, expect, it } from 'vitest';
import { confirmPreview, declinePreview, declineReason, lapsePreview, onlineSummary, transferBooking, transferPreview, websiteOrigin, type OnlineForPreview, type OrderForPreview } from './online-preview';
import { customerConfirmedMessage, customerDeclinedMessage, customerExpiredMessage, customerPaidMessage } from './notify';
import type { WebsiteBankDetails } from './types';

// All made up.
const online = (over: Partial<OnlineForPreview> = {}): OnlineForPreview => ({
  id: 'ONL-ABC234',
  state: 'to_confirm',
  token: 'tok-test',
  customer: { name: 'Sara Test', phone: '923000000001' },
  delivery: { address: '1 Test Street', city: 'Lahore' },
  lines: [
    { key: 'rings/test-1', description: 'Test ring (size 12)', price: 150_000, image: 'https://example.com/r.jpg', size: '12' },
    { key: 'studs/test-2', description: 'Test studs', price: 50_000, image: 'https://example.com/s.jpg' },
  ],
  subtotal: 200_000,
  deliveryCharge: 1_500,
  grandTotal: 201_500,
  ...over,
});

const noBank: WebsiteBankDetails = { bankName: '', accountTitle: 'Test Collections', accountNumber: '', iban: '' };
const fullBank: WebsiteBankDetails = { bankName: 'Test Bank', accountTitle: 'Test Collections', accountNumber: '0000111122', iban: 'PK00TEST0000000000000000' };
const on = { WEBSITE_NOTIFY: 'on' };
const now = new Date('2026-10-05T07:00:00Z');

const order = (over: Partial<OrderForPreview> = {}): OrderForPreview => ({
  id: 'ORD-000900',
  status: 'Pending',
  customerName: 'Sara Test',
  customerContact: '923000000001',
  subtotal: 200_000,
  advancePayment: 0,
  website: { paymentStatus: 'awaiting_transfer', deliveryCharge: 1_500, onlineId: 'ONL-ABC234', total: 201_500 },
  ...over,
});

describe('websiteOrigin', () => {
  it('is the site, without a trailing slash', () => {
    expect(websiteOrigin({})).toBe('https://taheri.shop');
    expect(websiteOrigin({ WEBSITE_ORIGIN: 'https://shop.example.com//' })).toBe('https://shop.example.com');
  });
});

describe('confirmPreview', () => {
  it('is the confirmation the customer is sent, the hold a day from now', () => {
    const p = confirmPreview(online(), { bank: noBank, origin: 'https://shop.example.com', holdHours: 24, now, env: on });
    expect(p.holdUntil).toBe('2026-10-06T07:00:00.000Z');
    expect(p.text).toBe(customerConfirmedMessage(onlineSummary(online(), 'https://shop.example.com', p.holdUntil), noBank));
    expect(p).toMatchObject({ move: 'confirm', ref: 'ONL-ABC234', name: 'Sara Test', to: '923000000001', sends: true });
    expect(p.text).toContain('your order ONL-ABC234 is confirmed');
    expect(p.text).toContain('*Total: Rs 201,500*');
    // The shop sends its account itself when the ERP does not know it whole.
    expect(p.text).toContain('We are sending you our bank details here on WhatsApp now');
    expect(p.text).toContain('https://shop.example.com/order/ONL-ABC234?t=tok-test');
  });

  it('carries the account when the ERP knows it whole', () => {
    const p = confirmPreview(online(), { bank: fullBank, origin: 'https://shop.example.com', holdHours: 12, now, env: on });
    expect(p.text).toContain('IBAN PK00TEST0000000000000000');
    expect(p.holdUntil).toBe('2026-10-05T19:00:00.000Z');
  });

  it('says nothing goes when WhatsApp is off or there is no number', () => {
    expect(confirmPreview(online(), { bank: noBank, origin: 'x', holdHours: 24, now, env: { WEBSITE_NOTIFY: 'off' } }).sends).toBe(false);
    expect(confirmPreview(online({ customer: { name: 'No Phone', phone: '' } }), { bank: noBank, origin: 'x', holdHours: 24, now, env: on }).sends).toBe(false);
  });

  it('refuses one already confirmed or declined, as confirming does', () => {
    const opts = { bank: noBank, origin: 'x', holdHours: 24, now, env: on };
    expect(() => confirmPreview(online({ state: 'confirmed' }), opts)).toThrow(/confirmed already/);
    expect(() => confirmPreview(online({ state: 'declined' }), opts)).toThrow(/declined/);
    // One being confirmed by someone else: the confirm itself says who.
    expect(confirmPreview(online({ state: 'confirming' }), opts).move).toBe('confirm');
  });
});

describe('declinePreview', () => {
  it('is the decline the customer is sent, the reason as it is kept', () => {
    const p = declinePreview(online(), '  We cannot deliver to this city.  ', { origin: 'https://shop.example.com', env: on });
    expect(p.text).toBe(customerDeclinedMessage('ONL-ABC234', 'Sara Test', 'We cannot deliver to this city.', 'https://shop.example.com/order/ONL-ABC234?t=tok-test'));
    expect(p.text).toContain("we can't take it as it was placed: We cannot deliver to this city.");
    expect(p).toMatchObject({ move: 'decline', to: '923000000001', sends: true });
  });

  it('needs a reason of a few words, and keeps 300 characters of one', () => {
    expect(() => declinePreview(online(), ' no', { origin: 'x', env: on })).toThrow(/Say why/);
    expect(() => declinePreview(online(), null, { origin: 'x', env: on })).toThrow(/Say why/);
    expect(declineReason('a'.repeat(400))).toHaveLength(300);
  });

  it('refuses one confirmed, being confirmed, or declined', () => {
    expect(() => declinePreview(online({ state: 'confirmed' }), 'A good reason', { origin: 'x', env: on })).toThrow(/cancel the order itself/);
    expect(() => declinePreview(online({ state: 'confirming' }), 'A good reason', { origin: 'x', env: on })).toThrow(/cancel the order itself/);
    expect(() => declinePreview(online({ state: 'declined' }), 'A good reason', { origin: 'x', env: on })).toThrow(/declined already/);
  });
});

describe('transferBooking', () => {
  it('books the pieces as the advance and the delivery as extra revenue', () => {
    expect(transferBooking(order())).toEqual({ advance: 200_000, deliveryRevenue: 1_500, total: 201_500 });
  });

  it('takes off what is already advanced, discounted or exchanged, never below nothing', () => {
    expect(transferBooking(order({ advancePayment: 50_000, discountAmount: 10_000, advanceInExchangeValue: 20_000 })).advance).toBe(120_000);
    expect(transferBooking(order({ advancePayment: 250_000 })).advance).toBe(0);
  });

  it('has no delivery revenue when delivery was free, and works the total out when it is missing', () => {
    expect(transferBooking(order({ website: { paymentStatus: 'awaiting_transfer', deliveryCharge: 0 } }))).toEqual({ advance: 200_000, deliveryRevenue: 0, total: 200_000 });
    expect(transferBooking(order({ website: { paymentStatus: 'slip_sent', deliveryCharge: 900 } })).total).toBe(200_900);
  });
});

describe('transferPreview', () => {
  it('is the thank-you the customer is sent, with what is booked', () => {
    const p = transferPreview(order(), on);
    expect(p.text).toBe(customerPaidMessage('ONL-ABC234', 'Sara Test'));
    expect(p).toMatchObject({ move: 'transfer_received', ref: 'ONL-ABC234', to: '923000000001', sends: true, booking: { advance: 200_000, deliveryRevenue: 1_500 } });
  });

  it('greets "there" without a name and names the order without an ONL- number', () => {
    const p = transferPreview(order({ customerName: '', website: { paymentStatus: 'awaiting_transfer', deliveryCharge: 0 } }), on);
    expect(p.ref).toBe('ORD-000900');
    expect(p.text).toContain('Assalamualaikum there');
  });

  it('refuses what markTransferReceived refuses, and one already paid', () => {
    expect(() => transferPreview(order({ website: undefined }), on)).toThrow(/Not an online order/);
    expect(() => transferPreview(order({ website: { paymentStatus: 'transfer_received', deliveryCharge: 0 } }), on)).toThrow(/recorded already/);
    expect(() => transferPreview(order({ status: 'Cancelled' }), on)).toThrow(/closed/);
    expect(() => transferPreview(order({ status: 'Refunded' }), on)).toThrow(/closed/);
    expect(() => transferPreview(order({ invoiceId: 'INV-000001' }), on)).toThrow(/invoiced/);
  });
});

describe('lapsePreview', () => {
  it('is the lapse the customer is sent', () => {
    const p = lapsePreview(order({ status: 'In Progress' }), on);
    expect(p.text).toBe(customerExpiredMessage('ONL-ABC234', 'Sara Test'));
    expect(p).toMatchObject({ move: 'lapse', sends: true });
    expect(lapsePreview(order({ customerContact: '' }), on).sends).toBe(false);
  });

  it('refuses what lapseOrder refuses', () => {
    expect(() => lapsePreview(order({ website: { paymentStatus: 'expired', deliveryCharge: 0 } }), on)).toThrow(/lapsed already/);
    expect(() => lapsePreview(order({ website: { paymentStatus: 'transfer_received', deliveryCharge: 0 } }), on)).toThrow(/paid/);
    expect(() => lapsePreview(order({ status: 'Completed' }), on)).toThrow('The order is Completed.');
    expect(() => lapsePreview(order({ website: undefined }), on)).toThrow(/Not an online order/);
  });
});
