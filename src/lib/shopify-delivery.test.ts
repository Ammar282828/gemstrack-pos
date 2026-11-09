import { describe, expect, it } from 'vitest';
import { deliveryLabel, deliveryOf, isShippedOut } from './shopify-delivery';
import { isBehind } from './shopify-order-sweep';

const f = (shipment_status: string | null, extra: Record<string, unknown> = {}) => ({ status: 'success', shipment_status, tracking_company: 'TCS', tracking_number: '173019776509', created_at: '2026-11-07T14:27:42Z', updated_at: '2026-11-08T06:29:39Z', ...extra });

describe('where a Shopify parcel is (TCS through Universal Courier)', () => {
  it('reads each TCS state', () => {
    expect(deliveryOf({ fulfillments: [f('delivered')] })).toEqual({ delivery: 'delivered', tracking: { company: 'TCS', number: '173019776509' }, at: '2026-11-08T06:29:39Z' });
    expect(deliveryOf({ fulfillments: [f('in_transit')] }).delivery).toBe('in_transit');
    expect(deliveryOf({ fulfillments: [f('attempted_delivery')] }).delivery).toBe('attempted');
    expect(deliveryOf({ fulfillments: [f('out_for_delivery')] }).delivery).toBe('out_for_delivery');
    expect(deliveryOf({ fulfillments: [f('failure')] }).delivery).toBe('returned');
    expect(deliveryOf({ fulfillments: [f(null)] }).delivery).toBe('shipped');
  });
  it('shipped then cancelled on Shopify is returned (#1434: NOT_DELIVERED, voided)', () => {
    expect(deliveryOf({ cancelled_at: '2026-10-29T13:46:41Z', fulfillments: [f('in_transit')] }).delivery).toBe('returned');
  });
  it('cancelled before it shipped is unfulfilled (#1386: the only parcel cancelled)', () => {
    expect(deliveryOf({ cancelled_at: '2026-09-23T13:16:03Z', fulfillments: [f(null, { status: 'cancelled' })] }).delivery).toBe('unfulfilled');
  });
  it('the latest live parcel counts over a cancelled one (#1469)', () => {
    const d = deliveryOf({ fulfillments: [f(null, { status: 'cancelled', tracking_number: 'old', created_at: '2026-11-07T10:44:28Z' }), f('in_transit', { tracking_number: 'new' })] });
    expect(d).toMatchObject({ delivery: 'in_transit', tracking: { number: 'new' } });
  });
  it('fulfilled by hand with no parcel (collected) has left the shop', () => {
    expect(deliveryOf({ fulfillment_status: 'fulfilled', fulfillments: [] }).delivery).toBe('shipped');
    expect(deliveryOf({ fulfillments: [] }).delivery).toBe('unfulfilled');
  });
  it('labels and what counts as gone', () => {
    expect(deliveryLabel('in_transit', 'TCS')).toBe('With TCS');
    expect(deliveryLabel('returned')).toBe('Returned');
    expect(deliveryLabel('unfulfilled')).toBeNull();
    expect(isShippedOut('delivered') && isShippedOut('attempted') && !isShippedOut('returned') && !isShippedOut('unfulfilled')).toBe(true);
  });
});

describe('the catch-up\'s "is the ERP behind?"', () => {
  const listed = { id: 1, name: '#1460', financial_status: 'paid', fulfillment_status: 'fulfilled', cancelled_at: null, fulfillments: [f('delivered')] };
  it('behind on delivery, fulfilment, payment or cancel; level when they agree', () => {
    expect(isBehind({ shopifyFulfillment: 'fulfilled', shopifyFinancialStatus: 'paid', shopifyDelivery: 'delivered' }, listed)).toBe(false);
    expect(isBehind({ shopifyFulfillment: 'fulfilled', shopifyFinancialStatus: 'paid' }, listed)).toBe(true);
    expect(isBehind({ shopifyFulfillment: 'unfulfilled', shopifyFinancialStatus: 'paid', shopifyDelivery: 'delivered' }, listed)).toBe(true);
    expect(isBehind({ shopifyFulfillment: 'fulfilled', shopifyFinancialStatus: 'pending', shopifyDelivery: 'delivered' }, listed)).toBe(true);
    expect(isBehind({ shopifyFulfillment: 'fulfilled', shopifyFinancialStatus: 'paid', shopifyDelivery: 'delivered', shopifyCancelledAt: 'x' }, listed)).toBe(true);
  });
});
