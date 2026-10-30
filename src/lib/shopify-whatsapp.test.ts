import { describe, expect, it } from 'vitest';
import { codPoll, messageKey, orderFlowKind, orderMessage, orderPhone, readCodReply, readPollVote, senderNumber, withTag, type ShopifyOrderLike } from './shopify-whatsapp';

const NOW = Date.parse('2026-10-30T13:00:00Z');
const order = (o: Partial<ShopifyOrderLike> = {}): ShopifyOrderLike => ({
  id: 1, order_number: 1459, name: '#1459', source_name: 'web', payment_gateway_names: ['Cash on Delivery (COD)'],
  financial_status: 'pending', cancelled_at: null, created_at: '2026-10-30T08:32:22Z', total_price: '8350.0',
  shipping_address: { first_name: 'Ayesha', address1: 'House 12, Street 4', address2: 'DHA Phase 6', city: 'Karachi', phone: '0300 1234567' },
  line_items: [{ title: 'Pearl Halo Ring', variant_title: '7', quantity: 1, price: '6350.00' }],
  shipping_lines: [{ price: '2000.00' }],
  ...o,
});
const BANK = { bankLine: 'Bank Al Habib  |  House of Mina', iban: 'PK42 BAHL 1227 0981 0022 7801' };

describe('which flow an order gets', () => {
  it('cash on delivery, bank deposit and paid website checkouts each have their own', () => {
    expect(orderFlowKind(order(), NOW)).toBe('cod');
    expect(orderFlowKind(order({ payment_gateway_names: ['Bank Deposit'] }), NOW)).toBe('bank');
    expect(orderFlowKind(order({ payment_gateway_names: ['Safepay Checkout Onsite'], financial_status: 'paid' }), NOW)).toBe('paid');
    // A bank deposit already marked paid is thanked, not asked for money.
    expect(orderFlowKind(order({ payment_gateway_names: ['Bank Deposit'], financial_status: 'paid' }), NOW)).toBe('paid');
  });
  it("leaves the shop's own orders, cancelled ones, free ones and old ones alone", () => {
    expect(orderFlowKind(order({ source_name: 'shopify_draft_order' }), NOW)).toBeNull();
    expect(orderFlowKind(order({ source_name: '338070634497', payment_gateway_names: ['manual'] }), NOW)).toBeNull();
    expect(orderFlowKind(order({ cancelled_at: '2026-10-30T09:00:00Z' }), NOW)).toBeNull();
    expect(orderFlowKind(order({ total_price: '0.0', payment_gateway_names: [] }), NOW)).toBeNull();
    expect(orderFlowKind(order({ created_at: '2026-10-20T08:00:00Z' }), NOW)).toBeNull();
    expect(orderFlowKind(order({ payment_gateway_names: ['Safepay Checkout Onsite'], financial_status: 'pending' }), NOW)).toBeNull();
  });
  it('messages the shipping number first', () => {
    expect(orderPhone(order())).toBe('0300 1234567');
    expect(orderPhone(order({ shipping_address: { phone: '' }, billing_address: { phone: '+92 321 0000000' } }))).toBe('+92 321 0000000');
  });
});

describe('the messages', () => {
  it('COD: the order, the total, where it goes, and 1 or 2', () => {
    const m = orderMessage('cod', order(), BANK);
    expect(m).toContain('Hi Ayesha');
    expect(m).toContain('*#1459*');
    expect(m).toContain('• Pearl Halo Ring (7) — Rs 6,350');
    expect(m).toContain('Delivery: Rs 2,000');
    expect(m).toContain('*Total, cash on delivery: Rs 8,350*');
    expect(m).toContain('Delivering to: House 12, Street 4, DHA Phase 6, Karachi');
    expect(m).toContain('tap *Confirm* below');
    expect(m).toContain('reply *1* to confirm, *2* to cancel');
  });
  it('COD: a Confirm / Cancel poll to tap, whose taps are read back', () => {
    const p = codPoll({ name: '#1459' });
    expect(p).toEqual({ name: 'Confirm your order #1459?', options: ['✅ Confirm order', '❌ Cancel order'] });
    expect(readPollVote(['✅ Confirm order'])).toBe('confirm');
    expect(readPollVote(['❌ Cancel order'])).toBe('decline');
    expect(readPollVote([])).toBeNull(); // a vote taken back
    expect(readPollVote(['✅ Confirm order', '❌ Cancel order'])).toBeNull();
    expect(messageKey('true_923262275554@c.us_3EB0B66848AFF42624EA94')).toBe('3EB0B66848AFF42624EA94');
    expect(messageKey('3EB0B66848AFF42624EA94')).toBe('3EB0B66848AFF42624EA94');
  });
  it("bank transfer: the house's bank and IBAN, and asks for the screenshot", () => {
    const m = orderMessage('bank', order({ payment_gateway_names: ['Bank Deposit'] }), BANK);
    expect(m).toContain('*Bank Al Habib · House of Mina*');
    expect(m).toContain('IBAN: *PK42 BAHL 1227 0981 0022 7801*');
    expect(m).toContain('payment screenshot');
    expect(m).not.toContain('Confirm');
  });
  it('paid: a thank-you with the details, and nothing to do', () => {
    const m = orderMessage('paid', order({ financial_status: 'paid', line_items: [{ title: 'Charm', variant_title: 'Default Title', quantity: 2, price: '1500' }] }), BANK);
    expect(m).toContain('Your payment is in');
    expect(m).toContain('• Charm × 2 — Rs 3,000');
    expect(m).toContain('*Paid: Rs 8,350*');
    expect(m).not.toMatch(/IBAN|reply \*1\*/);
  });
});

describe('reading a reply', () => {
  it('confirm, cancel, or a question left for a person', () => {
    for (const t of ['1', ' 1 ', 'Yes', 'yes!', 'Confirm', 'ok', 'Ji', 'haan', '✅', '👍']) expect(readCodReply(t), t).toBe('confirm');
    for (const t of ['2', 'No', 'cancel', 'Cancel order', 'nahi', '❌']) expect(readCodReply(t), t).toBe('decline');
    for (const t of ['', 'when will it arrive?', 'can I change the size to 8', '12', 'yes but change the address']) expect(readCodReply(t), t).toBeNull();
  });
  it("finds the customer's number behind WhatsApp's private id", () => {
    expect(senderNumber({ from: '923001234567@c.us' })).toBe('923001234567');
    expect(senderNumber({ from: '123456789012345@lid', _data: { Info: { SenderAlt: '923001234567@s.whatsapp.net' } } })).toBe('923001234567');
    expect(senderNumber({ from: '123456789012345@lid', _data: { Info: { SenderAlt: '923001234567:12@s.whatsapp.net' } } })).toBe('923001234567');
    expect(senderNumber({ from: '123456789012345@lid' })).toBe('');
  });
  it('adds a Shopify tag once', () => {
    expect(withTag('', 'Confirm')).toBe('Confirm');
    expect(withTag('TCS, WhatsApp', 'Confirm')).toBe('TCS, WhatsApp, Confirm');
    expect(withTag('confirm, TCS', 'Confirm')).toBe('confirm, TCS');
  });
});
