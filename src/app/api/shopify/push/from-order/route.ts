import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { shopifyRequest, getShopifyCredentials } from '../../_lib';
import { verifyRequestEmail, isOwnerEmail } from '@/lib/karigar-auth';

/**
 * Create a Shopify order for a POS order, so a courier can be booked for it.
 *
 * TCS is booked by fulfilling an order in Shopify — Universal Courier watches
 * for the fulfilment and raises the Envio consignment. A custom order taken in
 * the shop has no Shopify order, so there is nothing to fulfil; this makes one.
 *
 * Line items are custom — a title and a price, never a variant id — so nothing
 * is added to the Shopify product catalogue. Receipts are suppressed: this
 * order exists to carry a shipment, not to sell to the customer again.
 */

async function requireOwner(req: NextRequest): Promise<boolean> {
  return isOwnerEmail(await verifyRequestEmail(req));
}

interface OrderItem {
  description?: string; totalEstimate?: number; manualPrice?: number;
  referenceSku?: string; size?: string;
}

/** Split a one-line address into the parts Shopify expects. */
function shippingAddress(order: Record<string, any>) {
  const d = order.delivery;
  const address = (d?.address || '').trim();
  if (!d?.required || !address) return undefined;
  const [first, ...rest] = String(order.customerName || 'Customer').trim().split(/\s+/);
  return {
    first_name: first || 'Customer',
    last_name: rest.join(' ') || '-',
    name: d.contactName?.trim() || order.customerName || 'Customer',
    address1: address,
    city: (d.city || '').trim() || undefined,
    country: 'Pakistan',
    phone: (d.contactPhone || order.customerContact || '').trim() || undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!await requireOwner(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orderId } = await request.json();
    if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 });

    const snap = await adminDb.collection('orders').doc(orderId).get();
    if (!snap.exists) return NextResponse.json({ error: `Order ${orderId} not found` }, { status: 404 });
    const order = snap.data()!;

    // Never make a second one. Two Shopify orders for one POS order would mean
    // two consignments for one parcel.
    if (order.shopifyOrderId) {
      return NextResponse.json({
        alreadyLinked: true,
        shopifyOrderId: String(order.shopifyOrderId),
        shopifyOrderNumber: order.shopifyOrderNumber ?? null,
      });
    }

    const items: OrderItem[] = Array.isArray(order.items) ? order.items : [];
    const lineItems = items.map(it => ({
      title: [it.description || 'Custom piece', it.size ? `Size ${it.size}` : ''].filter(Boolean).join(' — '),
      price: Number(it.manualPrice || it.totalEstimate || 0).toFixed(2),
      quantity: 1,
      // POS prices are the final all-in amount — never charge tax on top.
      taxable: false,
      requires_shipping: true,
      ...(it.referenceSku ? { sku: it.referenceSku } : {}),
    }));
    if (!lineItems.length) {
      return NextResponse.json({ error: `${orderId} has no items to ship` }, { status: 400 });
    }

    const { shop, token } = await getShopifyCredentials(adminDb);
    const paid = Number(order.advancePayment || 0) + Number(order.advanceInExchangeValue || 0)
      >= Number(order.grandTotal || 0);
    const ship = shippingAddress(order);

    const created = await shopifyRequest(shop, token, 'POST', '/orders.json', {
      order: {
        line_items: lineItems,
        financial_status: paid ? 'paid' : 'pending',
        tax_exempt: true,
        taxes_included: true,
        note: `POS order ${orderId}`,
        tags: 'pos-order,courier',
        created_at: order.createdAt,
        ...(order.customerContact ? { phone: order.customerContact } : {}),
        ...(ship ? { shipping_address: ship } : {}),
        ...(Number(order.discountAmount || 0) > 0 && {
          discount_codes: [{ code: 'POS-DISCOUNT', amount: Number(order.discountAmount).toFixed(2), type: 'fixed_amount' }],
        }),
        // The customer already has their estimate from the POS; this order is
        // only here so the shipment can be booked.
        send_receipt: false,
        send_fulfillment_receipt: false,
        // Custom line items carry no variant, so nothing is stocked or
        // decremented — but say so rather than rely on it.
        inventory_behaviour: 'bypass',
      },
    });

    const shopifyOrderId = String(created.order.id);
    const shopifyOrderNumber = created.order.order_number;
    await snap.ref.update({ shopifyOrderId, shopifyOrderNumber });

    return NextResponse.json({
      success: true,
      shopifyOrderId,
      shopifyOrderNumber,
      hasShippingAddress: !!ship,
      items: lineItems.length,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
