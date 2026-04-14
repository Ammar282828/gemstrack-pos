import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { shopifyRequest, getShopifyCredentials, mapCustomerToShopify } from '../../_lib';

export async function POST(request: NextRequest) {
  try {
    const { customerId } = await request.json();
    if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 });

    const { shop, token } = await getShopifyCredentials(adminDb);

    const customerDoc = await adminDb.collection('customers').doc(customerId).get();
    if (!customerDoc.exists) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    const customer = customerDoc.data()!;

    // Skip if this customer came from Shopify (avoid echo loop)
    if (customerId.startsWith('shopify-')) {
      return NextResponse.json({ skipped: true, reason: 'shopify-originated' });
    }

    const payload = mapCustomerToShopify(customer);
    let shopifyCustomerId = customer.shopifyCustomerId;

    if (shopifyCustomerId) {
      // Update existing Shopify customer
      await shopifyRequest(shop, token, 'PUT', `/customers/${shopifyCustomerId}.json`, payload);
    } else {
      // Create new Shopify customer
      const result = await shopifyRequest(shop, token, 'POST', '/customers.json', payload);
      shopifyCustomerId = String(result.customer.id);
      // Store the Shopify ID back on the POS customer
      await adminDb.collection('customers').doc(customerId).update({ shopifyCustomerId });
    }

    return NextResponse.json({ success: true, shopifyCustomerId });
  } catch (e: any) {
    console.error('[shopify/push/customer]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
