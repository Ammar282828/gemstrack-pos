import { NextRequest, NextResponse } from 'next/server';
import { fetchAllPages, mapCustomer, mapInvoice, mapProduct, shopifyRequest, mapCustomerToShopify } from '../_lib';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { syncOrders = true, syncCustomers = true, syncProducts = false } = body;

    const shop = process.env.SHOPIFY_STORE_DOMAIN || (await adminDb.collection('app_settings').doc('global').get()).data()?.shopifyStoreDomain;
    const token = process.env.SHOPIFY_ACCESS_TOKEN || (await adminDb.collection('app_settings').doc('global').get()).data()?.shopifyAccessToken;
    if (!shop || !token) return NextResponse.json({ error: 'Shopify not connected.' }, { status: 400 });

    const results = { orders: 0, customers: 0, products: 0, pushed: 0, skipped: 0, errors: [] as string[] };

    // ── Pull: Shopify → POS ──

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

    // ── Push: POS → Shopify ──

    try {
      const allInvoices = await adminDb.collection('invoices').get();

      // Build fingerprint set from SHOPIFY- docs to detect re-entered POS copies
      // Fingerprint = "customerName|grandTotal" — catches manual re-entries
      const shopifyFingerprints = new Set<string>();
      const shopifyCustomerTotals = new Map<string, Set<number>>();
      for (const d of allInvoices.docs) {
        if (d.id.startsWith('SHOPIFY-') || (d.data().source && d.data().source.includes('shopify'))) {
          const data = d.data();
          const key = (data.customerName || '').toLowerCase().trim();
          const total = Math.round((data.grandTotal || 0) * 100);
          shopifyFingerprints.add(`${key}|${total}`);
          if (!shopifyCustomerTotals.has(key)) shopifyCustomerTotals.set(key, new Set());
          shopifyCustomerTotals.get(key)!.add(total);
        }
      }

      for (const invDoc of allInvoices.docs) {
        const inv = invDoc.data();
        const invoiceId = invDoc.id;

        // Skip Shopify-originated, already-pushed, refunded, or empty
        if (invoiceId.startsWith('SHOPIFY-')) { continue; }
        if (inv.source && inv.source.includes('shopify')) { continue; }
        if (inv.shopifyOrderId) { continue; }
        if (inv.status === 'Refunded') { continue; }

        // Skip if this looks like a re-entry of a Shopify order (same customer + same total)
        const custKey = (inv.customerName || '').toLowerCase().trim();
        const invTotal = Math.round((inv.grandTotal || 0) * 100);
        if (shopifyFingerprints.has(`${custKey}|${invTotal}`)) {
          results.skipped++;
          continue;
        }
        const lineItems = (inv.items || []).map((item: any) => ({
          title: item.name || 'POS Item',
          price: ((item.itemTotal || 0) / (item.quantity || 1)).toFixed(2),
          quantity: item.quantity || 1,
          ...(item.sku && { sku: item.sku }),
        }));
        if (lineItems.length === 0) { continue; }

        try {
          let shopifyCustomer: { id: number } | undefined;
          if (inv.customerId) {
            const custDoc = await adminDb.collection('customers').doc(inv.customerId).get();
            if (custDoc.exists) {
              const scId = custDoc.data()?.shopifyCustomerId;
              if (scId) shopifyCustomer = { id: Number(scId) };
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
                discount_codes: [{ code: 'POS-DISCOUNT', amount: inv.discountAmount.toFixed(2), type: 'fixed_amount' }],
              }),
              created_at: inv.createdAt,
              tags: 'pos-import',
              send_receipt: false,
              send_fulfillment_receipt: false,
            },
          });
          await invDoc.ref.update({ shopifyOrderId: String(result.order.id), shopifyOrderNumber: result.order.order_number });
          results.pushed++;
        } catch (e: any) {
          results.errors.push(`Push ${invoiceId}: ${e.message}`);
        }
      }
    } catch (e: any) { results.errors.push(`Push scan: ${e.message}`); }

    // Also push POS customers that don't have a Shopify ID yet
    if (syncCustomers) {
      try {
        const allCustomers = await adminDb.collection('customers').get();
        for (const custDoc of allCustomers.docs) {
          const cust = custDoc.data();
          if (custDoc.id.startsWith('shopify-')) continue;
          if (cust.shopifyCustomerId) continue;
          try {
            const payload = mapCustomerToShopify(cust);
            const result = await shopifyRequest(shop, token, 'POST', '/customers.json', payload);
            await custDoc.ref.update({ shopifyCustomerId: String(result.customer.id) });
          } catch (e: any) {
            // 422 = duplicate email/phone, not a real error
            if (!e.message?.includes('422')) {
              results.errors.push(`Push customer ${custDoc.id}: ${e.message}`);
            }
          }
        }
      } catch (e: any) { results.errors.push(`Push customers: ${e.message}`); }
    }

    await adminDb.collection('app_settings').doc('global').update({ shopifyLastSyncedAt: new Date().toISOString() });
    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
