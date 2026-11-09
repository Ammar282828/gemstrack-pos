/**
 * Where a Shopify web order's parcel is, from Shopify's own fulfilments (House of Mina: TCS, booked through the Universal
 * Courier app, which writes the courier's tracking back as each fulfilment's `shipment_status`). Owner, 2026-11-09: "cross
 * check with shopify and see what tcs delivery status is; a lot of the shopify orders on erp have been fulfilled or
 * returned; update them".
 *
 * Pure; the mirror (lib/shopify-mirror.ts) writes it as `shopifyDelivery` onto the ERP's order or invoice, and the order's
 * status follows from it (lib/writes/shopify-order.ts): shipped is made and gone (Completed); returned and cancelled on
 * Shopify with nothing paid is Cancelled.
 */

export type ShopifyDelivery = 'unfulfilled' | 'shipped' | 'in_transit' | 'out_for_delivery' | 'attempted' | 'delivered' | 'returned';

export interface ShopifyFulfillmentLike {
  status?: string | null;
  shipment_status?: string | null;
  tracking_company?: string | null;
  tracking_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DeliveryState {
  delivery: ShopifyDelivery;
  /** The courier and its number, from the parcel that counts (the latest one not cancelled). */
  tracking?: { company: string; number: string };
  /** When it was delivered or came back (the fulfilment's last change), for the card's date. */
  at?: string;
}

/** The parcel that counts: the latest fulfilment not cancelled or failed to book. */
function liveFulfillment(list: ShopifyFulfillmentLike[] | null | undefined): ShopifyFulfillmentLike | undefined {
  return (list || [])
    .filter(f => f && !['cancelled', 'error', 'failure'].includes(String(f.status || '').toLowerCase()))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
}

export function deliveryOf(order: { fulfillments?: ShopifyFulfillmentLike[] | null; cancelled_at?: string | null; fulfillment_status?: string | null }): DeliveryState {
  const f = liveFulfillment(order.fulfillments);
  if (!f) {
    // No parcel on record but Shopify calls it fulfilled (marked by hand, collected in person): it left the shop.
    return { delivery: String(order.fulfillment_status || '').toLowerCase() === 'fulfilled' && !order.cancelled_at ? 'shipped' : 'unfulfilled' };
  }
  const company = String(f.tracking_company || '').trim();
  const number = String(f.tracking_number || '').trim();
  const tracking = number ? { tracking: { company: company || 'Courier', number } } : {};
  const ss = String(f.shipment_status || '').toLowerCase();
  const at = f.updated_at || f.created_at || undefined;
  if (ss === 'delivered') return { delivery: 'delivered', ...tracking, ...(at && { at }) };
  // Not delivered, or shipped and then cancelled on Shopify: the parcel came back (a COD refused at the door).
  if (ss === 'failure' || ss === 'not_delivered' || order.cancelled_at) return { delivery: 'returned', ...tracking, ...(at && { at }) };
  if (ss === 'attempted_delivery') return { delivery: 'attempted', ...tracking };
  if (ss === 'out_for_delivery') return { delivery: 'out_for_delivery', ...tracking };
  if (ss === 'in_transit' || ss === 'confirmed' || ss === 'ready_for_pickup') return { delivery: 'in_transit', ...tracking };
  return { delivery: 'shipped', ...tracking };
}

/** It has left the shop and is not back: the piece is made. */
export const isShippedOut = (d: string | null | undefined) =>
  d === 'shipped' || d === 'in_transit' || d === 'out_for_delivery' || d === 'attempted' || d === 'delivered';

/** The card's words ("Delivered", "With TCS", "Returned"). */
export function deliveryLabel(d: string | null | undefined, company?: string | null): string | null {
  const c = (company || '').trim() || 'courier';
  switch (d) {
    case 'delivered': return 'Delivered';
    case 'returned': return 'Returned';
    case 'attempted': return 'Delivery attempted';
    case 'out_for_delivery': return 'Out for delivery';
    case 'in_transit': return `With ${c}`;
    case 'shipped': return 'Shipped';
    default: return null;
  }
}

/** The card's tone (lib/tones.ts): delivered settled, returned late, an attempt owed (it may come back), on its way working. */
export function deliveryTone(d: string | null | undefined): 'settled' | 'late' | 'owed' | 'working' {
  return d === 'delivered' ? 'settled' : d === 'returned' ? 'late' : d === 'attempted' ? 'owed' : 'working';
}
