import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { shopifyRequest, getShopifyCredentials } from '../../_lib';

/**
 * Push a single POS invoice to Shopify as an order.
 * Skips Shopify-originated and already-pushed invoices.
 */
export async function POST(request: NextRequest) {
  try {
    const { invoiceId } = await request.json();
    if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });

    // Skip Shopify-originated invoices
    if (invoiceId.startsWith('SHOPIFY-')) {
      return NextResponse.json({ skipped: true, reason: 'shopify-originated' });
    }

    const invoiceDoc = await adminDb.collection('invoices').doc(invoiceId).get();
    if (!invoiceDoc.exists) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const inv = invoiceDoc.data()!;

    // Skip if already pushed or shopify-sourced
    if (inv.shopifyOrderId) {
      return NextResponse.json({ skipped: true, reason: 'already-pushed' });
    }
    if (inv.source && inv.source.includes('shopify')) {
      return NextResponse.json({ skipped: true, reason: 'shopify-originated' });
    }

    const { shop, token } = await getShopifyCredentials(adminDb);

    const lineItems = (inv.items || []).map((item: any) => ({
      title: item.name || 'POS Item',
      price: ((item.itemTotal || 0) / (item.quantity || 1)).toFixed(2),
      quantity: item.quantity || 1,
      ...(item.sku && { sku: item.sku }),
    }));

    if (lineItems.length === 0) {
      return NextResponse.json({ skipped: true, reason: 'no-items' });
    }

    // Resolve Shopify customer ID
    let shopifyCustomer: { id: number } | undefined;
    if (inv.customerId) {
      const custDoc = await adminDb.collection('customers').doc(inv.customerId).get();
      if (custDoc.exists) {
        const shopifyCustId = custDoc.data()?.shopifyCustomerId;
        if (shopifyCustId) shopifyCustomer = { id: Number(shopifyCustId) };
      }
    }

    const isPaid = (inv.balanceDue || 0) <= 0;

    const result = await shopifyRequest(shop, token, 'POST', '/orders.json', {
      order: {
        line_items: lineItems,
        financial_status: isPaid ? 'paid' : 'pending',
        note: `POS Invoice ${invoiceId}`,
        ...(shopifyCustomer && { customer: shopifyCustomer }),
        ...(inv.discountAmount > 0 && {
          discount_codes: [{
            code: 'POS-DISCOUNT',
            amount: inv.discountAmount.toFixed(2),
            type: 'fixed_amount',
          }],
        }),
        created_at: inv.createdAt,
        tags: 'pos-import',
        send_receipt: false,
        send_fulfillment_receipt: false,
      },
    });

    const shopifyOrderId = String(result.order.id);
    const shopifyOrderNumber = result.order.order_number;

    await invoiceDoc.ref.update({ shopifyOrderId, shopifyOrderNumber });

    return NextResponse.json({ success: true, shopifyOrderId, shopifyOrderNumber });
  } catch (e: any) {
    console.error('[shopify/push/order]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
