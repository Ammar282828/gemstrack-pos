import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { shopifyRequest, getShopifyCredentials, mapInvoiceToDraftOrder } from '../../_lib';

export async function POST(request: NextRequest) {
  try {
    const { invoiceId } = await request.json();
    if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });

    const { shop, token } = await getShopifyCredentials(adminDb);

    const invoiceDoc = await adminDb.collection('invoices').doc(invoiceId).get();
    if (!invoiceDoc.exists) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const invoiceData = invoiceDoc.data()! as Record<string, any>;
    const invoice = { id: invoiceId, ...invoiceData };

    // Resolve Shopify customer ID if possible
    let shopifyCustomerId: string | undefined;
    if (invoiceData.customerId) {
      const customerDoc = await adminDb.collection('customers').doc(invoiceData.customerId).get();
      if (customerDoc.exists) {
        shopifyCustomerId = customerDoc.data()?.shopifyCustomerId;
      }
    }

    const payload = mapInvoiceToDraftOrder(invoice, shopifyCustomerId);
    let draftOrderId = invoiceData.shopifyDraftOrderId;
    let checkoutUrl: string;

    if (draftOrderId) {
      // Update existing draft order
      const result = await shopifyRequest(shop, token, 'PUT', `/draft_orders/${draftOrderId}.json`, payload);
      checkoutUrl = result.draft_order.invoice_url;
    } else {
      // Create new draft order
      const result = await shopifyRequest(shop, token, 'POST', '/draft_orders.json', payload);
      draftOrderId = String(result.draft_order.id);
      checkoutUrl = result.draft_order.invoice_url;
    }

    // Store draft order ID and checkout URL on the invoice
    await adminDb.collection('invoices').doc(invoiceId).update({
      shopifyDraftOrderId: draftOrderId,
      shopifyCheckoutUrl: checkoutUrl,
    });

    return NextResponse.json({ success: true, draftOrderId, checkoutUrl });
  } catch (e: any) {
    console.error('[shopify/push/draft-order]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
