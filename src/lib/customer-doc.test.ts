import { describe, expect, it } from 'vitest';
import { lineGate, maskNumber, parseSendDoc, resolveRecipient } from './customer-doc';
import { contactHrefs, isWalkInContact } from './customer-contact';
import { orderFileName, orderTitle, orderWhatsAppCaption } from './invoice-share';
import { orderCustomerBlocks, orderPiecePrice } from './order-pdf';
import type { OrderItem } from './store';

describe('the send-doc request', () => {
  it('takes an invoice or an order by id, the number and per piece optional', () => {
    expect(parseSendDoc({ kind: 'invoice', id: 'INV-1', to: ' 0300 1234567 ', perPiece: true })).toEqual({ kind: 'invoice', id: 'INV-1', to: '0300 1234567', perPiece: true });
    expect(parseSendDoc({ kind: 'order', id: 'ORD-1', perPiece: true })).toEqual({ kind: 'order', id: 'ORD-1', to: undefined, perPiece: false });
  });
  it('refuses anything else', () => {
    expect(parseSendDoc({ kind: 'slip', id: 'ORD-1' })).toHaveProperty('error');
    expect(parseSendDoc({ kind: 'order', id: 'orders/ORD-1' })).toHaveProperty('error');
    expect(parseSendDoc(null)).toHaveProperty('error');
  });
});

describe('who it goes to', () => {
  it('the number typed, made dialable (03xx → 923xx)', () => {
    expect(resolveRecipient('0300 1234567', ['+44 20 7946 0000'])).toEqual({ to: '923001234567' });
    expect(resolveRecipient('+1 415 555 1234', [])).toEqual({ to: '14155551234' });
  });
  it('else the first number on file that is one', () => {
    expect(resolveRecipient(undefined, ['', null, '12', '0321-7654321'])).toEqual({ to: '923217654321' });
  });
  it('says so when there is none, or the typed one is not a number', () => {
    expect(resolveRecipient(undefined, [undefined, ''])).toHaveProperty('error');
    expect((resolveRecipient('123', ['03001234567']) as { error: string }).error).toContain('WhatsApp number');
  });
  it('shows the number masked in the answer', () => {
    expect(maskNumber('923001234567')).toBe('+92 300 ••• 4567');
  });
});

describe('the line', () => {
  it('sends from whichever line this house has, else asks for a link', () => {
    expect(lineGate('waha')).toBeNull();
    expect(lineGate('greenapi')).toBeNull();
    expect(lineGate(null)).toMatchObject({ status: 503, fallback: 'link' });
  });
});

describe('the Contact row', () => {
  it('one number for Call, WhatsApp and Message', () => {
    expect(contactHrefs('0300-1234567')).toEqual({ e164: '+923001234567', tel: 'tel:+923001234567', whatsapp: 'https://wa.me/923001234567', sms: 'sms:+923001234567' });
    expect(contactHrefs('0300 1234567', 'Salam')?.whatsapp).toBe('https://wa.me/923001234567?text=Salam');
    expect(contactHrefs('')).toBeNull();
  });
  it('a walk-in is nobody to call; a typed walk-in number is somebody', () => {
    expect(isWalkInContact({ customerName: 'Walk-in Customer' })).toBe(true);
    expect(isWalkInContact({})).toBe(true);
    expect(isWalkInContact({ customerName: 'Walk-in Customer - 03001234567' })).toBe(false);
    expect(isWalkInContact({ customerId: 'CUS-1', customerName: 'Walk-in Customer' })).toBe(false);
  });
});

describe("the customer's order PDF", () => {
  const piece = (o: Partial<OrderItem>): OrderItem => ({
    description: 'Bangle with leaf', itemCategory: 'cat001', karat: '21k', estimatedWeightG: 10, stoneWeightG: 0, hasStones: false,
    wastagePercentage: 10, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, sampleGiven: true, isCompleted: false, hasDiamonds: false,
    metalType: 'gold', totalEstimate: 300_000, adminNote: 'OWNER ONLY', karigarId: 'K-1', stoneDetails: 'Two rubies', ...o,
  } as OrderItem & { notes?: string });

  it("never the shop's notes, the karigar or the sample", () => {
    const [b] = orderCustomerBlocks({ items: [{ ...piece({}), notes: 'BENCH ONLY' } as OrderItem] });
    const all = [b.name, b.spec, ...b.settings, ...b.breakdown].join('\n');
    expect(all).not.toMatch(/OWNER ONLY|BENCH ONLY|K-1|sample/i);
    expect(all).toContain('Bangle with leaf');
    expect(all).toContain('Est. 10g');
    expect(all).toContain('Wastage 1.00g');
    expect(all).toContain('Stones: Two rubies');
  });
  it('a fixed price is the price; silver has no wastage', () => {
    expect(orderPiecePrice(piece({ isManualPrice: true, manualPrice: 50_000 }))).toBe(50_000);
    expect(orderPiecePrice(piece({}))).toBe(300_000);
    expect(orderCustomerBlocks({ items: [piece({ metalType: 'silver' })] })[0].spec).not.toContain('Wastage');
  });
  it('named for the customer, captioned with what is left to pay', () => {
    expect(orderFileName({ customerName: 'Fatima Hussain' })).toBe('Order - Fatima Hussain.pdf');
    expect(orderTitle({ customerName: 'Walk-in Customer', createdAt: '2026-10-05T10:00:00Z' })).toBe('Order - 5 Oct 2026');
    const c = orderWhatsAppCaption({ customerName: 'Fatima', subtotal: 300_000, discountAmount: 10_000, advancePayment: 90_000, grandTotal: 200_000, promisedDate: '2026-11-20' }, 'Taheri');
    expect(c).toContain('Your order with Taheri is attached.');
    expect(c).toContain('*Total:* PKR 290,000');
    expect(c).toContain('*Advance paid:* PKR 90,000');
    expect(c).toContain('*Balance due:* PKR 200,000');
    expect(c).toContain('*Ready by:* 20 Nov 2026');
    expect(c).not.toMatch(/ORD|http/);
  });
});
