import { describe, expect, it } from 'vitest';
import { isShopifyInvoice, isShopifyCancelled, isToConfirm, isCancelRequested, shopifyChipsOf, CANCEL_REQUESTED_NOTE } from './shopify-orders';

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
  it('Shopify-cancelled and refunded are Cancelled, and nothing else', () => {
    expect(isShopifyCancelled({ shopifyCancelledAt: '2026-11-01T00:00:00Z' })).toBe(true);
    expect(isShopifyCancelled({ status: 'Refunded' })).toBe(true);
    expect(shopifyChipsOf({ balanceDue: 900, status: 'Cancelled' })).toEqual(['all', 'cancelled']);
    expect(isToConfirm({ whatsappOrder: { state: 'awaiting-confirmation' }, shopifyCancelledAt: 'x' })).toBe(false);
  });
  it('paid and unpaid follow the balance; no WhatsApp state is fine', () => {
    expect(shopifyChipsOf({ balanceDue: 0 })).toEqual(['all', 'paid']);
    expect(shopifyChipsOf({ balanceDue: 1200 })).toEqual(['all', 'unpaid']);
    expect(shopifyChipsOf({ balanceDue: -300 })).toEqual(['all', 'paid']);
  });
});

describe('a customer who declined on WhatsApp', () => {
  it('has only asked: the order is not closed until the order itself is cancelled', () => {
    const declined = { balanceDue: 900, whatsappOrder: { state: 'declined' } };
    expect(isShopifyCancelled(declined)).toBe(false);
    expect(isCancelRequested(declined)).toBe(true);
    expect(shopifyChipsOf(declined)).toEqual(['all', 'declined', 'unpaid']);
    expect(CANCEL_REQUESTED_NOTE).toBe('Customer declined on WhatsApp — cancel the order?');
  });
  it('once the order is Cancelled (or Shopify cancelled it) it is Cancelled, no longer a question', () => {
    for (const closed of [{ status: 'Cancelled' }, { status: 'Refunded' }, { shopifyCancelledAt: '2026-11-01T00:00:00Z' }]) {
      const inv = { balanceDue: 900, whatsappOrder: { state: 'declined' }, ...closed };
      expect(isCancelRequested(inv)).toBe(false);
      expect(shopifyChipsOf(inv)).toEqual(['all', 'cancelled']);
    }
  });
});
