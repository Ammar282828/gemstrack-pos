/**
 * A parcel's tracking, asked of whoever knows (lib/tracking.ts has the shape and the readers). Server only.
 *
 * TCS first when the order has a consignment number and the TCS account can book (lib/tcs-cod-server.ts); else, or when
 * TCS answers nothing, Shopify's fulfilment and its events; else what the order itself recorded. Kept 10 minutes in
 * tcs_tracking/<cn> (or tcs_tracking/shopify-<order id> before there is a number), so a page opened twice or a
 * customer pressing refresh does not ask TCS or Shopify again.
 */
import { adminDb } from '@/lib/firebase-admin';
import { getShopifyCredentials, shopifyRequest } from '@/app/api/shopify/_lib';
import { codReady } from '@/lib/tcs-payments';
import { tcsCredentials } from '@/lib/tcs-payments-server';
import { tcsTrackOrder } from '@/lib/tcs-cod-server';
import { fromRecord, fromShopify, fromTcs, liveShopifyFulfillment, type ShopifyFulfillmentEvent, type ShopifyFulfillmentFull, type Tracking } from '@/lib/tracking';

const TTL_MS = 10 * 60_000;

export interface TrackingAsk {
  cn?: string | null;
  shopifyOrderId?: string | null;
  /** What the order recorded, for when neither TCS nor Shopify answers. */
  record?: { shopifyDelivery?: string | null; shopifyTracking?: { company?: string; number?: string } | null; shopifyDeliveryAt?: string | null; bookedAt?: string | null };
  /** Skip the cache (the ERP's Refresh). */
  fresh?: boolean;
}

/** The order's tracking (or invoice's) from its document, as the routes read it. */
export function askOf(doc: Record<string, unknown>): TrackingAsk {
  const booking = doc.tcsBooking as { cn?: string; cancelledAt?: string; bookedAt?: string } | undefined;
  const live = booking?.cn && !booking.cancelledAt ? booking : undefined;
  const st = doc.shopifyTracking as { company?: string; number?: string } | undefined;
  // A booking the shop cancelled (tcsCancelledCns) is never asked about again, whichever field still carries its number.
  const cancelled = new Set((Array.isArray(doc.tcsCancelledCns) ? doc.tcsCancelledCns : []).map(c => String(c).trim()));
  const notCancelled = (c: string | undefined | null) => (c && !cancelled.has(String(c).trim()) ? c : '');
  const cn = (typeof doc.tcsConsignmentNo === 'string' && notCancelled(doc.tcsConsignmentNo)) || notCancelled(live?.cn) || (st?.number && /tcs/i.test(st.company || '') ? notCancelled(st.number) : '') || null;
  return {
    cn,
    shopifyOrderId: typeof doc.shopifyOrderId === 'string' ? doc.shopifyOrderId : doc.shopifyOrderId ? String(doc.shopifyOrderId) : null,
    record: {
      shopifyDelivery: (doc.shopifyDelivery as string) || null, shopifyTracking: st || null,
      shopifyDeliveryAt: (doc.shopifyDeliveryAt as string) || null, bookedAt: live?.bookedAt || null,
    },
  };
}

async function viaShopify(shopifyOrderId: string): Promise<Tracking | null> {
  const { shop, token } = await getShopifyCredentials(adminDb);
  const o = (await shopifyRequest(shop, token, 'GET', `/orders/${encodeURIComponent(shopifyOrderId)}.json?fields=id,fulfillments,fulfillment_status,cancelled_at`))?.order;
  if (!o) return null;
  const f = liveShopifyFulfillment(o.fulfillments as ShopifyFulfillmentFull[]);
  let events: ShopifyFulfillmentEvent[] = [];
  if (f?.id) {
    events = (await shopifyRequest(shop, token, 'GET', `/orders/${encodeURIComponent(shopifyOrderId)}/fulfillments/${f.id}/events.json`).catch(() => null))?.fulfillment_events || [];
  }
  return fromShopify(o, events);
}

export async function getTracking(ask: TrackingAsk): Promise<Tracking | null> {
  const key = ask.cn ? String(ask.cn) : ask.shopifyOrderId ? `shopify-${ask.shopifyOrderId}` : '';
  if (!key || key.includes('/')) return fromRecord({ ...(ask.record || {}), cn: ask.cn });
  const ref = adminDb.collection('tcs_tracking').doc(key);
  if (!ask.fresh) {
    const kept = (await ref.get().catch(() => null))?.data() as { at?: string; tracking?: Tracking } | undefined;
    if (kept?.tracking && kept.at && Date.now() - Date.parse(kept.at) < TTL_MS) return kept.tracking;
  }

  let t: Tracking | null = null;
  if (ask.cn) {
    const c = await tcsCredentials().catch(() => null);
    if (codReady(c)) {
      try {
        const r = await tcsTrackOrder(String(ask.cn));
        if (r) t = fromTcs(String(ask.cn), r);
      } catch (e) {
        // Not opened to the API yet, or TCS is down: Shopify's word instead.
        console.warn('[tracking] TCS', ask.cn, e instanceof Error ? e.message : e);
      }
    }
  }
  if (!t && ask.shopifyOrderId) {
    try { t = await viaShopify(String(ask.shopifyOrderId)); } catch (e) { console.warn('[tracking] Shopify', ask.shopifyOrderId, e instanceof Error ? e.message : e); }
    // Shopify knows nothing yet but the ERP booked it: say booked, not "not shipped".
    if (t && t.state === 'unfulfilled' && ask.cn) t = fromRecord({ ...(ask.record || {}), cn: ask.cn }) || t;
  }
  if (!t) t = fromRecord({ ...(ask.record || {}), cn: ask.cn });
  if (t) await ref.set({ at: new Date().toISOString(), tracking: t }).catch(() => {});
  return t;
}
