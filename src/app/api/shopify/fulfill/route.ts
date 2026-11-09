import { NextRequest, NextResponse } from 'next/server';
import { shopifyRequest, getShopifyCredentials } from '../_lib';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail, isOwnerEmail } from '@/lib/karigar-auth';
import { fulfilShopifyOrder, openFulfillmentOrders } from '@/lib/shopify-fulfil-server';

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

    // The one fulfilment (lib/shopify-fulfil-server.ts): tracking is optional, Universal Courier fills it in once Envio
    // returns a consignment number; with one (booked from the ERP) it rides on the fulfilment.
    const r = await fulfilShopifyOrder(String(shopifyOrderId), {
      notifyCustomer: !!notifyCustomer,
      ...(trackingNumber ? { tracking: { number: String(trackingNumber), ...(trackingCompany ? { company: String(trackingCompany) } : {}) } } : {}),
    });
    if (!r.ok) return NextResponse.json({ error: r.message }, { status: 409 });
    return NextResponse.json({
      success: true,
      fulfillmentId: r.fulfillmentId,
      status: r.status,
      trackingNumber: r.trackingNumber ?? null,
      notifiedCustomer: !!notifyCustomer,
      message: r.message,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
