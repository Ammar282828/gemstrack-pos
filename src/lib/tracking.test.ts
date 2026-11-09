import { describe, expect, it } from 'vitest';
import { firstNameOf, fromRecord, fromShopify, fromTcs, parseOrderRef, phoneLast4, phoneMatches, trackingLabel } from './tracking';

const NOW = new Date('2026-11-10T00:00:00Z');

describe('fromShopify', () => {
  const order = {
    fulfillment_status: 'fulfilled',
    fulfillments: [
      { id: 1, status: 'cancelled', tracking_company: 'TCS', tracking_number: '111111111', created_at: '2026-11-07T10:00:00Z' },
      { id: 2, status: 'success', shipment_status: 'out_for_delivery', tracking_company: 'TCS', tracking_number: '779412345678', tracking_url: 'https://www.tcsexpress.com/track/779412345678', created_at: '2026-11-08T10:00:00Z' },
    ],
  };
  const events = [
    { status: 'in_transit', happened_at: '2026-11-08T20:00:00+05:00', city: 'Karachi', province: 'Sindh', message: 'Departed from origin' },
    { status: 'out_for_delivery', happened_at: '2026-11-09T09:30:00+05:00', city: 'Lahore', message: null },
  ];
  it('reads the live fulfilment and its events, newest first', () => {
    const t = fromShopify(order, events, NOW);
    expect(t).toMatchObject({ source: 'shopify', carrier: 'TCS', cn: '779412345678', state: 'out_for_delivery', status: 'Out for delivery', url: 'https://www.tcsexpress.com/track/779412345678' });
    expect(t.events).toEqual([
      { at: '2026-11-09T04:30:00.000Z', status: 'Out for delivery', location: 'Lahore' },
      { at: '2026-11-08T15:00:00.000Z', status: 'Departed from origin', location: 'Karachi, Sindh' },
      { at: '2026-11-08T10:00:00.000Z', status: 'Shipped with TCS' },
    ]);
  });
  it('a delivered parcel carries its day; a TCS number with no url gets TCS’s page', () => {
    const t = fromShopify({ fulfillments: [{ id: 3, status: 'success', shipment_status: 'delivered', tracking_company: 'TCS', tracking_number: '779400000001', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-03T10:00:00Z' }] },
      [{ status: 'delivered', happened_at: '2026-11-03T09:00:00Z' }], NOW);
    expect(t).toMatchObject({ state: 'delivered', deliveredAt: '2026-11-03T09:00:00.000Z', url: 'https://www.tcsexpress.com/track/779400000001' });
  });
  it('not shipped: unfulfilled, no events', () => {
    expect(fromShopify({ fulfillments: [] }, [], NOW)).toMatchObject({ state: 'unfulfilled', status: 'Not shipped yet', events: [], cn: null, url: null });
  });
});

describe('fromTcs and fromRecord', () => {
  it('wraps TCS’s reading', () => {
    expect(fromTcs('779412345678', { status: 'Delivered', state: 'delivered', events: [{ at: 'x', status: 'Delivered' }], deliveredAt: 'x', receivedBy: 'Ayesha' }, NOW))
      .toMatchObject({ source: 'tcs', carrier: 'TCS', status: 'Delivered', receivedBy: 'Ayesha', url: 'https://www.tcsexpress.com/track/779412345678', checkedAt: NOW.toISOString() });
  });
  it('a number booked and nothing heard: booked', () => {
    expect(fromRecord({ cn: '779412345678', bookedAt: '2026-11-09T10:00:00Z' }, NOW)).toMatchObject({ state: 'booked', status: 'Booked with TCS', events: [{ status: 'Booked with TCS' }] });
  });
  it('the mirror’s last word', () => {
    expect(fromRecord({ shopifyDelivery: 'returned', shopifyTracking: { company: 'TCS', number: '1' }, shopifyDeliveryAt: '2026-11-05T00:00:00Z' }, NOW)).toMatchObject({ state: 'returned', cn: '1' });
    expect(fromRecord({}, NOW)).toBeNull();
    expect(fromRecord({ shopifyDelivery: 'unfulfilled' }, NOW)).toBeNull();
  });
  it('labels', () => {
    expect(trackingLabel('in_transit', 'TCS')).toBe('With TCS');
    expect(trackingLabel('cancelled')).toBe('Booking cancelled');
  });
});

describe('the website’s lookup', () => {
  it('reads what the customer typed as an order', () => {
    expect(parseOrderRef('#1460')).toEqual({ shopifyNumber: 1460 });
    expect(parseOrderRef(' 1460 ')).toEqual({ shopifyNumber: 1460 });
    expect(parseOrderRef('SHOPIFY-1460')).toEqual({ shopifyNumber: 1460 });
    expect(parseOrderRef('ord-000123')).toEqual({ id: 'ORD-000123' });
    expect(parseOrderRef('')).toBeNull();
    expect(parseOrderRef('../etc')).toBeNull();
  });
  it('matches the last four digits of any of the order’s numbers', () => {
    expect(phoneLast4('+92 300 123 4567')).toBe('4567');
    expect(phoneLast4('45')).toBeNull();
    expect(phoneMatches(['+92 300 1234567'], '4567')).toBe(true);
    expect(phoneMatches(['03001234567', null], '4568')).toBe(false);
    expect(phoneMatches(['', '4567'], '4567')).toBe(false); // a number too short to be a phone never matches
    expect(phoneMatches(['03001234567'], null)).toBe(false);
  });
  it('shows a first name only', () => {
    expect(firstNameOf('Ayesha Khan')).toBe('Ayesha');
    expect(firstNameOf(undefined)).toBe('');
  });
});
