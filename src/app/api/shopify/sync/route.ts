import { NextRequest, NextResponse } from 'next/server';
import { fetchAllPages, mapCustomer, mapInvoice, mapProduct } from '../_lib';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { syncOrders = true, syncCustomers = true, syncProducts = false } = body;

    const shop = process.env.SHOPIFY_STORE_DOMAIN || (await adminDb.collection('app_settings').doc('global').get()).data()?.shopifyStoreDomain;
    const token = process.env.SHOPIFY_ACCESS_TOKEN || (await adminDb.collection('app_settings').doc('global').get()).data()?.shopifyAccessToken;
    if (!shop || !token) return NextResponse.json({ error: 'Shopify not connected.' }, { status: 400 });

    const results = { orders: 0, customers: 0, products: 0, skipped: 0, errors: [] as string[] };

    if (syncCustomers) {
      try {
        const shopifyCustomers = await fetchAllPages(shop, token, '/customers.json', 'customers');
        for (const sc of shopifyCustomers) {
          const id = `shopify-${sc.id}`;
          const existing = await adminDb.collection('customers').doc(id).get();
          if (!existing.exists) {
            await adminDb.collection('customers').doc(id).set(mapCustomer(sc));
            results.customers++;
          } else {
            results.skipped++;
          }
        }
      } catch (e: any) { results.errors.push(`Customers: ${e.message}`); }
    }

    if (syncOrders) {
      try {
        // Pre-build sets of already-imported Shopify order names/IDs (handles both CSV and API imports)
        const existingNames = new Set<string>();
        const existingShopifyIds = new Set<string>();

        const [csvSnap, apiSnap] = await Promise.all([
          adminDb.collection('invoices').where('source', '==', 'shopify_import').get(),
          adminDb.collection('invoices').where('source', '==', 'shopify').get(),
        ]);
        for (const doc of [...csvSnap.docs, ...apiSnap.docs]) {
          const d = doc.data();
          if (d.shopifyOrderName) existingNames.add(d.shopifyOrderName);
          if (d.shopifyOrderId) existingShopifyIds.add(d.shopifyOrderId);
        }

        const shopifyOrders = await fetchAllPages(shop, token, '/orders.json?status=any', 'orders');
        for (const order of shopifyOrders) {
          const docId = `SHOPIFY-${order.order_number}`;
          const orderName = `#${order.order_number}`;
          const orderId = String(order.id);

          if (existingNames.has(orderName) || existingShopifyIds.has(orderId)) { results.skipped++; continue; }
          const existing = await adminDb.collection('invoices').doc(docId).get();
          if (!existing.exists) {
            await adminDb.collection('invoices').doc(docId).set(mapInvoice(order));
            results.orders++;
          } else {
            results.skipped++;
          }
        }
      } catch (e: any) { results.errors.push(`Orders: ${e.message}`); }
    }

    if (syncProducts) {
      try {
        const shopifyProducts = await fetchAllPages(shop, token, '/products.json', 'products');
        for (const sp of shopifyProducts) {
          for (const variant of (sp.variants || [])) {
            const sku = variant.sku || `SHOPIFY-PROD-${variant.id}`;
            const existing = await adminDb.collection('products').doc(sku).get();
            if (!existing.exists) {
              await adminDb.collection('products').doc(sku).set(mapProduct(sp, variant));
              results.products++;
            } else {
              results.skipped++;
            }
          }
        }
      } catch (e: any) { results.errors.push(`Products: ${e.message}`); }
    }

    await adminDb.collection('app_settings').doc('global').update({ shopifyLastSyncedAt: new Date().toISOString() });
    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
