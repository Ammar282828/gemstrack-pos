import { NextRequest, NextResponse } from 'next/server';
import { shopifyRequest, getShopifyCredentials } from '../_lib';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail, isOwnerEmail } from '@/lib/karigar-auth';

/**
 * Fulfil a Shopify order, which is how a courier actually gets booked here.
 *
 * The shop books TCS by fulfilling the order in Shopify; the Universal Courier
 * app watches for that and creates the Envio consignment. So the POS does not
 * talk to a courier at all — it performs the one action that starts the chain,
 * and the booking comes back later as a tracking number on the Shopify order.
 *
 * Deliberately no order creation. If a POS order has no Shopify order behind
 * it there is nothing to fulfil, and inventing one would put a custom order on
 * the public storefront.
 *
 * GET  ?shopifyOrderId=…  reports what could be fulfilled, and writes nothing.
 * POST fulfils it.
 */

async function requireOwner(req: NextRequest): Promise<boolean> {
  return isOwnerEmail(await verifyRequestEmail(req));
}

interface FulfillmentOrder {
  id: number;
  status: string;
  supported_actions?: string[];
  line_items?: unknown[];
  assigned_location_id?: number;
}

/** The open fulfilment orders Shopify will actually accept a fulfilment for. */
async function openFulfillmentOrders(shop: string, token: string, orderId: string): Promise<FulfillmentOrder[]> {
  const res = await shopifyRequest(shop, token, 'GET', `/orders/${orderId}/fulfillment_orders.json`);
  const all: FulfillmentOrder[] = res?.fulfillment_orders || [];
  return all.filter(f => f.supported_actions?.includes('create_fulfillment'));
}

export async function GET(request: NextRequest) {
  try {
    if (!await requireOwner(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const shopifyOrderId = new URL(request.url).searchParams.get('shopifyOrderId');
    if (!shopifyOrderId) return NextResponse.json({ error: 'shopifyOrderId is required' }, { status: 400 });

    const { shop, token } = await getShopifyCredentials(adminDb);
    const order = await shopifyRequest(shop, token, 'GET',
      `/orders/${shopifyOrderId}.json?fields=id,order_number,fulfillment_status,fulfillments`);
    const open = await openFulfillmentOrders(shop, token, shopifyOrderId);

    const tracking = (order?.order?.fulfillments || [])
      .map((f: { tracking_number?: string; tracking_company?: string; status?: string }) => ({
        trackingNumber: f.tracking_number, company: f.tracking_company, status: f.status,
      }))
      .filter((t: { trackingNumber?: string }) => t.trackingNumber);

    return NextResponse.json({
      orderNumber: order?.order?.order_number,
      fulfillmentStatus: order?.order?.fulfillment_status ?? 'unfulfilled',
      canFulfil: open.length > 0,
      fulfillmentOrders: open.map(f => ({ id: f.id, status: f.status, items: (f.line_items || []).length })),
      tracking,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!await requireOwner(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { shopifyOrderId, notifyCustomer = false, trackingNumber, trackingCompany } = await request.json();
    if (!shopifyOrderId) return NextResponse.json({ error: 'shopifyOrderId is required' }, { status: 400 });

    const { shop, token } = await getShopifyCredentials(adminDb);
    const open = await openFulfillmentOrders(shop, token, String(shopifyOrderId));
    if (!open.length) {
      // Already fulfilled, on hold, or cancelled — say which rather than
      // failing with a bare Shopify error.
      const order = await shopifyRequest(shop, token, 'GET',
        `/orders/${shopifyOrderId}.json?fields=id,order_number,fulfillment_status`);
      return NextResponse.json({
        error: `Nothing to fulfil on #${order?.order?.order_number ?? shopifyOrderId} — it is ${order?.order?.fulfillment_status ?? 'not fulfillable'}.`,
      }, { status: 409 });
    }

    // One fulfilment covering every open fulfilment order, which is what
    // "ship this order" means. Tracking is optional: Universal Courier fills
    // it in once Envio returns a consignment number.
    const payload: Record<string, unknown> = {
      line_items_by_fulfillment_order: open.map(f => ({ fulfillment_order_id: f.id })),
      notify_customer: !!notifyCustomer,
    };
    if (trackingNumber) {
      payload.tracking_info = {
        number: String(trackingNumber),
        ...(trackingCompany ? { company: String(trackingCompany) } : {}),
      };
    }

    const created = await shopifyRequest(shop, token, 'POST', '/fulfillments.json', { fulfillment: payload });
    const f = created?.fulfillment;

    return NextResponse.json({
      success: true,
      fulfillmentId: f?.id,
      status: f?.status,
      trackingNumber: f?.tracking_number ?? null,
      notifiedCustomer: !!notifyCustomer,
      // The consignment number does not exist yet: Universal Courier books it
      // with Envio after this, and writes the tracking back onto the order.
      message: f?.tracking_number
        ? `Fulfilled with tracking ${f.tracking_number}.`
        : 'Fulfilled. Universal Courier will book it with Envio and add the tracking number.',
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
