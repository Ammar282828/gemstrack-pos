import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { shopifyRequest, getShopifyCredentials, mapCustomerToShopify, findShopifyCustomerId } from '../../_lib';

/**
 * Idempotent customer push. Resolves the Shopify customer in this order:
 *   1. The `shopifyCustomerId` already stored on the POS customer doc.
 *   2. A Shopify customer carrying tag `pos-customer-{customerId}`.
 *   3. A Shopify customer with a matching email or phone.
 *   4. None — create new.
 *
 * Always tags the customer with `pos-pushed` and `pos-customer-{id}` so the
 * `customers/update` webhook can skip the echo.
 */
export async function POST(request: NextRequest) {
  try {
    const { customerId } = await request.json();
    if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 });

    // Skip if this customer is a Shopify-webhook mirror doc (id = `shopify-{numericId}`).
    // CSV-imported docs (e.g. `shopify-cust-1772...`) are real POS customers and must
    // still be pushable.
    if (/^shopify-\d+$/.test(customerId)) {
      return NextResponse.json({ skipped: true, reason: 'shopify-originated' });
    }

    const { shop, token } = await getShopifyCredentials(adminDb);

    const customerDoc = await adminDb.collection('customers').doc(customerId).get();
    if (!customerDoc.exists) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    const customer = customerDoc.data()!;

    const payload = mapCustomerToShopify(customer, customerId);
    let shopifyCustomerId: string | undefined = customer.shopifyCustomerId;

    // Verify any stored id still exists; otherwise fall back to search.
    if (shopifyCustomerId) {
      try { await shopifyRequest(shop, token, 'GET', `/customers/${shopifyCustomerId}.json`); }
      catch { shopifyCustomerId = undefined; }
    }
    if (!shopifyCustomerId) {
      const found = await findShopifyCustomerId(shop, token, {
        posCustomerId: customerId,
        email: customer.email || undefined,
        phone: customer.phone || undefined,
      });
      if (found) shopifyCustomerId = found;
    }

    if (shopifyCustomerId) {
      await shopifyRequest(shop, token, 'PUT', `/customers/${shopifyCustomerId}.json`, {
        customer: { id: Number(shopifyCustomerId), ...payload.customer },
      });
      // Make sure the POS doc points at the right id (may have been wrong/missing)
      if (String(customer.shopifyCustomerId || '') !== String(shopifyCustomerId)) {
        await adminDb.collection('customers').doc(customerId).update({ shopifyCustomerId });
      }
    } else {
      try {
        const result = await shopifyRequest(shop, token, 'POST', '/customers.json', payload);
        shopifyCustomerId = String(result.customer.id);
        await adminDb.collection('customers').doc(customerId).update({ shopifyCustomerId });
      } catch (e: any) {
        // 422 typically means "email/phone already taken" — race or stale index.
        // Re-search aggressively, then PUT instead of giving up.
        if (!String(e?.message || '').includes('422')) throw e;
        const retry = await findShopifyCustomerId(shop, token, {
          posCustomerId: customerId,
          email: customer.email || undefined,
          phone: customer.phone || undefined,
        });
        if (!retry) throw e;
        shopifyCustomerId = retry;
        await shopifyRequest(shop, token, 'PUT', `/customers/${shopifyCustomerId}.json`, {
          customer: { id: Number(shopifyCustomerId), ...payload.customer },
        });
        await adminDb.collection('customers').doc(customerId).update({ shopifyCustomerId });
      }
    }

    return NextResponse.json({ success: true, shopifyCustomerId });
  } catch (e: any) {
    console.error('[shopify/push/customer]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
