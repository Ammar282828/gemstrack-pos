import { describe, expect, it } from 'vitest';
import { noticeOrderId } from './shopify-webhooks';

describe('which order a Shopify notice is about', () => {
  it('an order notice by its id, a parcel notice by its order_id', () => {
    expect(noticeOrderId('orders/updated', JSON.stringify({ id: 7445131428120 }))).toBe('7445131428120');
    expect(noticeOrderId('fulfillments/update', JSON.stringify({ id: 555, order_id: 7445131428120, shipment_status: 'delivered' }))).toBe('7445131428120');
    expect(noticeOrderId('fulfillments/create', JSON.stringify({ id: 555 }))).toBeNull();
    expect(noticeOrderId('orders/updated', 'not json')).toBeNull();
  });
});
