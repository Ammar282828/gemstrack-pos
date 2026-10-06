import { describe, expect, it } from 'vitest';
import { isPosPushedOrder, paymentLinkInvoiceId, shopifyPaymentMethod } from './shopify-mirror';

describe('which invoice a Shopify order speaks for', () => {
  it("an order the ERP pushed out is the ERP's own echo, whatever its note says", () => {
    // INV-000228: pushed partly paid, note "POS Invoice INV-000228" — the old handler read it as a paid checkout link.
    const pushed = { tags: 'pos-import, pos-inv-INV-000228', note: 'POS Invoice INV-000228' };
    expect(isPosPushedOrder(pushed)).toBe(true);
    expect(isPosPushedOrder({ tags: 'pos-inv-INV-1' })).toBe(true);
    expect(isPosPushedOrder({ tags: '' })).toBe(false);
    expect(isPosPushedOrder({ tags: null })).toBe(false);
  });
  it('a checkout link names its invoice in the note', () => {
    expect(paymentLinkInvoiceId({ note: 'POS Invoice INV-000312' })).toBe('INV-000312');
    expect(paymentLinkInvoiceId({ note: 'Gift wrap please' })).toBeNull();
    expect(paymentLinkInvoiceId({ note: null })).toBeNull();
  });
});

describe('how a Shopify payment reached the shop', () => {
  it('is never Cash: the drawer never saw it', () => {
    expect(shopifyPaymentMethod('Safepay Checkout Onsite')).toBe('Card');
    expect(shopifyPaymentMethod('Bank Deposit')).toBe('Bank Transfer');
    expect(shopifyPaymentMethod('Cash on Delivery (COD)')).toBe('Bank Transfer');
    expect(shopifyPaymentMethod('manual')).toBeUndefined();
    expect(shopifyPaymentMethod(undefined)).toBeUndefined();
  });
});
