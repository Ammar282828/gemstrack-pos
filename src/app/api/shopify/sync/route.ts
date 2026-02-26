import { NextRequest, NextResponse } from 'next/server';
import { firestoreGet, firestoreSet, toFirestoreFields, toFirestoreValue, fetchAllPages, mapCustomer, mapInvoice, mapProduct } from '../_lib';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { syncOrders = true, syncCustomers = true, syncProducts = false } = body;

    const settingsDoc = await firestoreGet('app_settings', 'global');
    if (!settingsDoc?.fields) return NextResponse.json({ error: 'Settings not found' }, { status: 404 });

    const shop = settingsDoc.fields.shopifyStoreDomain?.stringValue;
    const token = settingsDoc.fields.shopifyAccessToken?.stringValue;
    if (!shop || !token) return NextResponse.json({ error: 'Shopify not connected.' }, { status: 400 });

    const results = { orders: 0, customers: 0, products: 0, skipped: 0, errors: [] as string[] };

    if (syncCustomers) {
      try {
        const shopifyCustomers = await fetchAllPages(shop, token, '/customers.json', 'customers');
        for (const sc of shopifyCustomers) {
          const id = `shopify-${sc.id}`;
          const existing = await firestoreGet('customers', id);
          if (!existing?.fields) { await firestoreSet('customers', id, toFirestoreFields(mapCustomer(sc))); results.customers++; }
          else results.skipped++;
        }
      } catch (e: any) { results.errors.push(`Customers: ${e.message}`); }
    }

    if (syncOrders) {
      try {
        const shopifyOrders = await fetchAllPages(shop, token, '/orders.json?status=any', 'orders');
        for (const order of shopifyOrders) {
          const id = `SHOPIFY-${order.order_number}`;
          const existing = await firestoreGet('invoices', id);
          if (!existing?.fields) { await firestoreSet('invoices', id, toFirestoreFields(mapInvoice(order))); results.orders++; }
          else results.skipped++;
        }
      } catch (e: any) { results.errors.push(`Orders: ${e.message}`); }
    }

    if (syncProducts) {
      try {
        const shopifyProducts = await fetchAllPages(shop, token, '/products.json', 'products');
        for (const sp of shopifyProducts) {
          for (const variant of (sp.variants || [])) {
            const sku = variant.sku || `SHOPIFY-PROD-${variant.id}`;
            const existing = await firestoreGet('products', sku);
            if (!existing?.fields) { await firestoreSet('products', sku, toFirestoreFields(mapProduct(sp, variant))); results.products++; }
            else results.skipped++;
          }
        }
      } catch (e: any) { results.errors.push(`Products: ${e.message}`); }
    }

    await firestoreSet('app_settings', 'global', { shopifyLastSyncedAt: { stringValue: new Date().toISOString() } });
    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
