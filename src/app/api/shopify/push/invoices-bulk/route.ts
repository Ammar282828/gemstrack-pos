import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { shopifyRequest, getShopifyCredentials } from '../../_lib';

/**
 * Bulk-push POS-originated invoices to Shopify as orders.
 * Skips any invoice that:
 *   - originated from Shopify (source contains 'shopify', or id starts with 'SHOPIFY-')
 *   - already has a shopifyOrderId (was already pushed)
 */
export async function POST() {
  try {
    const { shop, token } = await getShopifyCredentials(adminDb);

    const snap = await adminDb.collection('invoices').get();
    const results = { pushed: 0, skipped: 0, errors: [] as string[] };

    for (const doc of snap.docs) {
      const inv = doc.data();
      const invoiceId = doc.id;

      // Skip Shopify-originated invoices
      if (invoiceId.startsWith('SHOPIFY-') || (inv.source && inv.source.includes('shopify'))) {
        results.skipped++;
        continue;
      }

      // Skip already-pushed invoices
      if (inv.shopifyOrderId) {
        results.skipped++;
        continue;
      }

      // Skip refunded/cancelled
      if (inv.status === 'Refunded') {
        results.skipped++;
        continue;
      }

      try {
        // Build Shopify order payload
        const lineItems = (inv.items || []).map((item: any) => ({
          title: item.name || 'POS Item',
          price: ((item.itemTotal || 0) / (item.quantity || 1)).toFixed(2),
          quantity: item.quantity || 1,
          ...(item.sku && { sku: item.sku }),
        }));

        if (lineItems.length === 0) {
          results.skipped++;
          continue;
        }

        // Resolve Shopify customer ID if available
        let shopifyCustomer: { id: number } | undefined;
        if (inv.customerId) {
          const custDoc = await adminDb.collection('customers').doc(inv.customerId).get();
          if (custDoc.exists) {
            const shopifyCustId = custDoc.data()?.shopifyCustomerId;
            if (shopifyCustId) shopifyCustomer = { id: Number(shopifyCustId) };
          }
        }

        const isPaid = (inv.balanceDue || 0) <= 0;

        const orderPayload = {
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
            // Use POS creation date
            created_at: inv.createdAt,
            // Mark as imported so it doesn't trigger fulfillment workflows
            tags: 'pos-import',
            // Suppress notifications to customer
            send_receipt: false,
            send_fulfillment_receipt: false,
          },
        };

        const result = await shopifyRequest(shop, token, 'POST', '/orders.json', orderPayload);
        const shopifyOrderId = String(result.order.id);
        const shopifyOrderNumber = result.order.order_number;

        // Store the Shopify order reference back on the POS invoice
        await doc.ref.update({
          shopifyOrderId,
          shopifyOrderNumber,
        });

        results.pushed++;
      } catch (e: any) {
        results.errors.push(`${invoiceId}: ${e.message}`);
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    console.error('[shopify/push/invoices-bulk]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
