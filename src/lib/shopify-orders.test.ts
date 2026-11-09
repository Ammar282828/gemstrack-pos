import { describe, expect, it } from 'vitest';
import { isShopifyInvoice, isShopifyCancelled, isToConfirm, shopifyChipsOf } from './shopify-orders';

describe('isShopifyInvoice', () => {
  it('is any source starting with shopify', () => {
    expect(isShopifyInvoice({ source: 'shopify' })).toBe(true);
    expect(isShopifyInvoice({ source: 'shopify_import' })).toBe(true);
    expect(isShopifyInvoice({ source: 'pos' })).toBe(false);
    expect(isShopifyInvoice({})).toBe(false);
    expect(isShopifyInvoice(null)).toBe(false);
  });
});

describe('classification', () => {
  it('an order awaiting its WhatsApp confirmation is To confirm', () => {
    const inv = { balanceDue: 5000, whatsappOrder: { state: 'awaiting-confirmation' } };
    expect(isToConfirm(inv)).toBe(true);
    expect(shopifyChipsOf(inv)).toEqual(['all', 'confirm', 'unpaid']);
  });
  it('a confirmed order is not To confirm', () => {
    expect(isToConfirm({ whatsappOrder: { state: 'confirmed' } })).toBe(false);
  });
  it('cancel requested, Shopify-cancelled and refunded are Cancelled, and nothing else', () => {
    expect(isShopifyCancelled({ whatsappOrder: { state: 'declined' } })).toBe(true);
    expect(isShopifyCancelled({ shopifyCancelledAt: '2026-11-01T00:00:00Z' })).toBe(true);
    expect(isShopifyCancelled({ status: 'Refunded' })).toBe(true);
    expect(shopifyChipsOf({ balanceDue: 900, whatsappOrder: { state: 'declined' } })).toEqual(['all', 'cancelled']);
    expect(isToConfirm({ whatsappOrder: { state: 'awaiting-confirmation' }, shopifyCancelledAt: 'x' })).toBe(false);
  });
  it('paid and unpaid follow the balance; no WhatsApp state is fine', () => {
    expect(shopifyChipsOf({ balanceDue: 0 })).toEqual(['all', 'paid']);
    expect(shopifyChipsOf({ balanceDue: 1200 })).toEqual(['all', 'unpaid']);
    expect(shopifyChipsOf({ balanceDue: -300 })).toEqual(['all', 'paid']);
  });
});
