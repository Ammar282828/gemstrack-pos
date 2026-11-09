/**
 * Fulfil a Shopify order (the one copy: /api/shopify/fulfill and the ERP's TCS booking, op bookTcs, both run it).
 *
 * With `tracking`, the fulfilment carries the consignment already booked from the ERP (company, number, url), so Shopify
 * and the customer's email show it. Without it, it is the older chain: Universal Courier watches for the fulfilment and
 * books its own consignment. Whether Universal Courier also books when a fulfilment arrives WITH tracking is its own
 * setting, not something this code can see; the booking dialog leaves the Shopify step as a choice for that reason.
 *
 * An order already fulfilled without a number gets the number added to its fulfilment (update_tracking), not a second one.
 */
import { adminDb } from '@/lib/firebase-admin';
import { getShopifyCredentials, shopifyRequest } from '@/app/api/shopify/_lib';

export interface FulfillmentOrder {
  id: number;
  status: string;
  supported_actions?: string[];
  line_items?: unknown[];
  assigned_location_id?: number;
}

export interface FulfilResult {
  ok: boolean;
  fulfillmentId?: number;
  status?: string;
  trackingNumber?: string | null;
  /** 'created' a new fulfilment; 'tracking-added' to one already there; 'nothing' when there was nothing to do. */
  how?: 'created' | 'tracking-added' | 'nothing';
  message: string;
}

/** The open fulfilment orders Shopify will actually accept a fulfilment for. */
export async function openFulfillmentOrders(shop: string, token: string, orderId: string): Promise<FulfillmentOrder[]> {
  const res = await shopifyRequest(shop, token, 'GET', `/orders/${orderId}/fulfillment_orders.json`);
  const all: FulfillmentOrder[] = res?.fulfillment_orders || [];
  return all.filter(f => f.supported_actions?.includes('create_fulfillment'));
}

export async function fulfilShopifyOrder(
  shopifyOrderId: string,
  opts: { notifyCustomer?: boolean; tracking?: { number: string; company?: string; url?: string } } = {},
): Promise<FulfilResult> {
  const { shop, token } = await getShopifyCredentials(adminDb);
  const id = String(shopifyOrderId);
  const t = opts.tracking;
  const info = t?.number ? { number: String(t.number), ...(t.company ? { company: String(t.company) } : {}), ...(t.url ? { url: String(t.url) } : {}) } : null;
  const open = await openFulfillmentOrders(shop, token, id);
  if (!open.length) {
    const order = await shopifyRequest(shop, token, 'GET', `/orders/${id}.json?fields=id,order_number,fulfillment_status,fulfillments`);
    const o = order?.order;
    // Fulfilled already with no number on it (by hand, or before the booking): put the number on that fulfilment.
    const bare = (o?.fulfillments || []).filter((f: { status?: string; tracking_number?: string | null }) => f.status === 'success' && !f.tracking_number);
    if (info && bare.length) {
      const f = bare[bare.length - 1];
      const upd = await shopifyRequest(shop, token, 'POST', `/fulfillments/${f.id}/update_tracking.json`, {
        fulfillment: { tracking_info: info, notify_customer: !!opts.notifyCustomer },
      });
      return { ok: true, how: 'tracking-added', fulfillmentId: upd?.fulfillment?.id ?? f.id, status: upd?.fulfillment?.status, trackingNumber: info.number, message: `Tracking ${info.number} added to #${o?.order_number ?? id}.` };
    }
    return { ok: false, how: 'nothing', message: `Nothing to fulfil on #${o?.order_number ?? id}: it is ${o?.fulfillment_status ?? 'not fulfillable'}.` };
  }
  const payload: Record<string, unknown> = {
    line_items_by_fulfillment_order: open.map(f => ({ fulfillment_order_id: f.id })),
    notify_customer: !!opts.notifyCustomer,
    ...(info ? { tracking_info: info } : {}),
  };
  const created = await shopifyRequest(shop, token, 'POST', '/fulfillments.json', { fulfillment: payload });
  const f = created?.fulfillment;
  return {
    ok: true, how: 'created', fulfillmentId: f?.id, status: f?.status, trackingNumber: f?.tracking_number ?? null,
    message: f?.tracking_number ? `Fulfilled with tracking ${f.tracking_number}.` : 'Fulfilled. Universal Courier will book it with Envio and add the tracking number.',
  };
}
