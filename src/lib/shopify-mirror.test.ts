import { describe, expect, it } from 'vitest';
import { isPosPushedOrder, paymentLinkInvoiceId, shippedPiecesDone, shopifyPaymentMethod } from './shopify-mirror';

describe('which invoice a Shopify order speaks for', () => {
  it("an order the ERP pushed out is the ERP's own echo, whatever its note says", () => {
    // INV-000228: pushed partly paid, note "POS Invoice INV-000228" — the old handler read it as a paid checkout link.
    const pushed = { tags: 'pos-import, pos-inv-INV-000228', note: 'POS Invoice INV-000228' };
    expect(isPosPushedOrder(pushed)).toBe(true);
    expect(isPosPushedOrder({ tags: 'pos-inv-INV-1' })).toBe(true);
    // A POS order sent to Shopify (push/from-order's 'pos-order,courier'; the order sync's pos-order-<id>).
    expect(isPosPushedOrder({ tags: 'pos-order,courier' })).toBe(true);
    expect(isPosPushedOrder({ tags: 'WhatsApp, pos-order-ORD-000175' })).toBe(true);
    expect(isPosPushedOrder({ tags: 'WhatsApp, COD' })).toBe(false);
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
    expect(shopifyPaymentMethod('JazzCash')).toBe('Bank Transfer');
    expect(shopifyPaymentMethod('Easypaisa Mobile Account')).toBe('Bank Transfer');
    expect(shopifyPaymentMethod('manual')).toBeUndefined();
    expect(shopifyPaymentMethod(undefined)).toBeUndefined();
  });
});

describe('shippedPiecesDone (a shipped web sale leaves the Workshop)', () => {
  const k = { name: 'Juno Knot Ring', karigarId: 'uzair' };
  it('ticks every piece once Shopify calls it fulfilled or TCS has it', () => {
    expect(shippedPiecesDone({ items: [k, { ...k, isCompleted: true }], shopifyFulfillment: 'fulfilled' })).toEqual([{ ...k, isCompleted: true }, { ...k, isCompleted: true }]);
    expect(shippedPiecesDone({ items: [k], shopifyFulfillment: 'unfulfilled', shopifyDelivery: 'in_transit' })).toEqual([{ ...k, isCompleted: true }]);
  });
  it('keeps the older map shape', () => {
    expect(shippedPiecesDone({ items: { 0: k }, shopifyFulfillment: 'fulfilled' })).toEqual({ 0: { ...k, isCompleted: true } });
  });
  it('leaves an unshipped, cancelled, returned or already-done sale alone', () => {
    expect(shippedPiecesDone({ items: [k], shopifyFulfillment: 'unfulfilled' })).toBeNull();
    expect(shippedPiecesDone({ items: [k], shopifyFulfillment: 'fulfilled', shopifyCancelledAt: '2026-11-01' })).toBeNull();
    expect(shippedPiecesDone({ items: [k], shopifyFulfillment: 'fulfilled', shopifyDelivery: 'returned' })).toBeNull();
    expect(shippedPiecesDone({ items: [{ ...k, isCompleted: true }], shopifyFulfillment: 'fulfilled' })).toBeNull();
  });
});
