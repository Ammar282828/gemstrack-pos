/**
 * Where a shipped order's parcel is, in one shape whoever answers (owner, 2026-11-09: "show me complete tracking on every
 * order of my ERP after shipping, so you won't need to refer to tags anymore"): TCS's own tracking (lib/tcs-cod.ts) when
 * the account works, else Shopify's fulfilment and its events (Universal Courier writes TCS's scans there). Pure; the
 * calls and the 10-minute cache are lib/tracking-server.ts, read by /api/app/tracking and /api/public/track.
 */

import { deliveryLabel, deliveryOf, type ShopifyFulfillmentLike } from '@/lib/shopify-delivery';
import { courierTime, stateOfText, tcsTrackUrl, type ParcelState, type TcsTrack, type TrackEvent } from '@/lib/tcs-cod';

export type TrackingState = ParcelState | 'unfulfilled';

export interface Tracking {
  source: 'tcs' | 'shopify';
  carrier: string;
  cn: string | null;
  /** The words to show ("Out for delivery", "With TCS"). */
  status: string;
  state: TrackingState;
  /** Newest first. */
  events: TrackEvent[];
  url: string | null;
  deliveredAt?: string;
  receivedBy?: string;
  checkedAt: string;
}

/** The card's words for a state. */
export function trackingLabel(state: TrackingState, carrier?: string | null): string {
  if (state === 'booked') return `Booked with ${carrier || 'the courier'}`;
  if (state === 'cancelled') return 'Booking cancelled';
  if (state === 'unfulfilled') return 'Not shipped yet';
  return deliveryLabel(state, carrier) || 'Shipped';
}

/** The tone (lib/tones.ts) for a state, as lib/shopify-delivery.ts's. */
export function trackingTone(state: TrackingState): 'settled' | 'late' | 'owed' | 'working' | 'quiet' {
  if (state === 'delivered') return 'settled';
  if (state === 'returned' || state === 'cancelled') return 'late';
  if (state === 'attempted') return 'owed';
  if (state === 'unfulfilled') return 'quiet';
  return 'working';
}

export function fromTcs(cn: string, t: TcsTrack, now = new Date()): Tracking {
  return {
    source: 'tcs', carrier: 'TCS', cn, state: t.state,
    status: trackingLabel(t.state, 'TCS'),
    events: t.events, url: tcsTrackUrl(cn),
    ...(t.deliveredAt && { deliveredAt: t.deliveredAt }),
    ...(t.receivedBy && { receivedBy: t.receivedBy }),
    checkedAt: now.toISOString(),
  };
}

/** Shopify's fulfilment event statuses in words. */
const SHOPIFY_EVENT: Record<string, string> = {
  label_printed: 'Label printed', label_purchased: 'Label bought', confirmed: 'Booked with the courier',
  carrier_picked_up: 'Picked up by the courier', picked_up: 'Picked up', in_transit: 'In transit', ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'Out for delivery', attempted_delivery: 'Delivery attempted', delayed: 'Delayed', delivered: 'Delivered', failure: 'Not delivered',
};

export interface ShopifyFulfillmentFull extends ShopifyFulfillmentLike {
  id?: number | string;
  tracking_url?: string | null;
  tracking_urls?: string[] | null;
}

export interface ShopifyFulfillmentEvent {
  status?: string | null;
  happened_at?: string | null;
  created_at?: string | null;
  city?: string | null;
  province?: string | null;
  message?: string | null;
}

/** The fulfilment that counts (latest not cancelled), as lib/shopify-delivery.ts picks it. */
export function liveShopifyFulfillment<T extends ShopifyFulfillmentLike>(list: T[] | null | undefined): T | undefined {
  return (list || [])
    .filter(f => f && !['cancelled', 'error', 'failure'].includes(String(f.status || '').toLowerCase()))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
}

/**
 * Shopify's word on the parcel: the order's fulfilments (for the state, the courier and its number) and the live one's
 * events (each a line on the timeline, the courier's message where it gave one), with "Shipped" at the fulfilment's time.
 */
export function fromShopify(
  order: { fulfillments?: ShopifyFulfillmentFull[] | null; cancelled_at?: string | null; fulfillment_status?: string | null },
  events: ShopifyFulfillmentEvent[] | null | undefined,
  now = new Date(),
): Tracking {
  const d = deliveryOf(order);
  const f = liveShopifyFulfillment(order.fulfillments);
  const carrier = d.tracking?.company || String(f?.tracking_company || '').trim() || 'Courier';
  const cn = d.tracking?.number || String(f?.tracking_number || '').trim() || null;
  const lines: TrackEvent[] = (events || []).map(e => {
    const status = String(e.message || '').trim() || SHOPIFY_EVENT[String(e.status || '')] || String(e.status || '').replace(/_/g, ' ');
    const location = [e.city, e.province].map(s => String(s || '').trim()).filter(Boolean).join(', ');
    return { at: courierTime(e.happened_at || e.created_at || ''), status, ...(location && { location }) };
  }).filter(e => e.status);
  if (f?.created_at) lines.push({ at: courierTime(f.created_at), status: `Shipped${cn ? ` with ${carrier}` : ''}` });
  lines.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  const state: TrackingState = d.delivery === 'unfulfilled' ? 'unfulfilled' : d.delivery;
  const url = String(f?.tracking_url || f?.tracking_urls?.[0] || '').trim() || (cn && /tcs/i.test(carrier) ? tcsTrackUrl(cn) : null);
  const delivered = state === 'delivered' ? lines.find(e => stateOfText(e.status) === 'delivered')?.at || d.at : undefined;
  return {
    source: 'shopify', carrier, cn, state, status: trackingLabel(state, carrier), events: lines, url,
    ...(delivered && { deliveredAt: delivered }),
    checkedAt: now.toISOString(),
  };
}

/** No courier to ask: what the order itself knows (a number booked, or Shopify's last word as the mirror kept it). */
export function fromRecord(rec: { cn?: string | null; shopifyDelivery?: string | null; shopifyTracking?: { company?: string; number?: string } | null; shopifyDeliveryAt?: string | null; bookedAt?: string | null }, now = new Date()): Tracking | null {
  const cn = rec.cn || rec.shopifyTracking?.number || null;
  const carrier = rec.shopifyTracking?.company || 'TCS';
  const known = ['shipped', 'in_transit', 'out_for_delivery', 'attempted', 'delivered', 'returned'];
  const state: TrackingState | null = rec.shopifyDelivery && known.includes(rec.shopifyDelivery) ? rec.shopifyDelivery as TrackingState : cn ? 'booked' : null;
  if (!state) return null;
  const events: TrackEvent[] = [];
  if (rec.shopifyDeliveryAt && (state === 'delivered' || state === 'returned')) events.push({ at: rec.shopifyDeliveryAt, status: trackingLabel(state, carrier) });
  if (rec.bookedAt) events.push({ at: rec.bookedAt, status: `Booked with ${carrier}` });
  return {
    source: 'shopify', carrier, cn, state, status: trackingLabel(state, carrier), events,
    url: cn && /tcs/i.test(carrier) ? tcsTrackUrl(cn) : null,
    ...(state === 'delivered' && rec.shopifyDeliveryAt && { deliveredAt: rec.shopifyDeliveryAt }),
    checkedAt: now.toISOString(),
  };
}

// ─── The website's lookup (/api/public/track) ────────────────────────────────

/**
 * What the customer typed as their order: "#1460", "1460", "SHOPIFY-1460", "hom1460" → the Shopify number; anything else
 * that looks like an ERP id (ORD-000123, INV-…) as itself. null for nonsense.
 */
export function parseOrderRef(raw: string | null | undefined): { shopifyNumber?: number; id?: string } | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 40) return null;
  const n = /^(?:#|shopify-|[a-z]{0,4})?\s*(\d{1,9})$/i.exec(s);
  if (n) return { shopifyNumber: Number(n[1]) };
  if (/^[A-Za-z][A-Za-z0-9_-]{2,39}$/.test(s)) return { id: s.toUpperCase() === s ? s : s.toUpperCase() };
  return null;
}

/** The last four digits the customer gave, or null. */
export function phoneLast4(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
}

/** Any of the order's numbers ends in those four digits. */
export function phoneMatches(numbers: (string | null | undefined)[], last4: string | null): boolean {
  if (!last4 || !/^\d{4}$/.test(last4)) return false;
  return numbers.some(n => { const d = String(n ?? '').replace(/\D/g, ''); return d.length >= 7 && d.endsWith(last4); });
}

/** A first name only: what the website may show of the customer. */
export const firstNameOf = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0] || '';
