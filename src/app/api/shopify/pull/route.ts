import { NextRequest, NextResponse } from 'next/server';
import { fetchAllPages, mapCustomer, mapInvoice, mapProduct, getShopifyCredentials } from '../_lib';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail, isOwnerEmail } from '@/lib/karigar-auth';

/** Only a signed-in owner may list or import Shopify orders. Without this the
 *  route exposed the storefront's order history — customer names, contacts and
 *  totals — to anyone who knew the URL, and let them write invoices. */
async function requireOwner(req: NextRequest): Promise<boolean> {
  return isOwnerEmail(await verifyRequestEmail(req));
}

/**
 * Selective pull: Shopify → POS.
 *
 * GET  lists everything on Shopify that is NOT yet in the POS, so it can be
 *      reviewed before anything is written. Read-only.
 * POST imports only the ids that were ticked.
 *
 * Deliberately one-directional. The older /api/shopify/sync route also pushes
 * POS invoices and customers *out* to Shopify, which creates real orders on the
 * storefront; nothing here writes to Shopify at all.
 */

interface PullItem {
  id: string;          // the id to send back to POST
  title: string;
  subtitle?: string;
  date?: string;
  amount?: number;
}

async function existingSets() {
  const [csvSnap, apiSnap, custSnap, prodSnap] = await Promise.all([
    adminDb.collection('invoices').where('source', '==', 'shopify_import').get(),
    adminDb.collection('invoices').where('source', '==', 'shopify').get(),
    adminDb.collection('customers').get(),
    adminDb.collection('products').get(),
  ]);

  const orderNames = new Set<string>();
  const orderIds = new Set<string>();
  for (const doc of [...csvSnap.docs, ...apiSnap.docs]) {
    const d = doc.data();
    if (d.shopifyOrderName) orderNames.add(d.shopifyOrderName);
    if (d.shopifyOrderId) orderIds.add(String(d.shopifyOrderId));
    orderNames.add(`#${doc.id.replace(/^SHOPIFY-/, '')}`);
  }

  const customerDocIds = new Set(custSnap.docs.map(d => d.id));
  const customerShopifyIds = new Set(
    custSnap.docs.map(d => String(d.data().shopifyCustomerId || '')).filter(Boolean),
  );
  const productSkus = new Set(prodSnap.docs.map(d => d.id));

  return { orderNames, orderIds, customerDocIds, customerShopifyIds, productSkus };
}

/** A storefront with many sized variants can have tens of thousands of them;
 *  the picker stays usable by capping the page and searching server-side. */
const PRODUCT_PAGE = 300;

/** Only orders placed after this Shopify order number are offered for import.
 *  Everything below it predates the POS and is deliberately not backfilled.
 *  Override per request with ?since=<number>. */
const SINCE_ORDER_NUMBER = 1381;

export async function GET(request: NextRequest) {
  try {
    if (!await requireOwner(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const q = (params.get('q') || '').trim().toLowerCase();
    const sinceRaw = Number(params.get('since'));
    const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : SINCE_ORDER_NUMBER;
    const { shop, token } = await getShopifyCredentials(adminDb);
    if (!shop || !token) return NextResponse.json({ error: 'Shopify not connected.' }, { status: 400 });

    const sets = await existingSets();
    const [orders, customers, products] = await Promise.all([
      fetchAllPages(shop, token, '/orders.json?status=any', 'orders'),
      fetchAllPages(shop, token, '/customers.json', 'customers'),
      fetchAllPages(shop, token, '/products.json', 'products'),
    ]);

    const newOrders: PullItem[] = [];
    let olderSkipped = 0;
    for (const o of orders) {
      if (sets.orderIds.has(String(o.id)) || sets.orderNames.has(`#${o.order_number}`)) continue;
      // Pre-cutoff orders are counted, not silently dropped, so the UI can say
      // how many exist below the line rather than implying none do.
      if (Number(o.order_number) <= since) { olderSkipped++; continue; }
      const who = o.customer
        ? [o.customer.first_name, o.customer.last_name].filter(Boolean).join(' ') || o.email
        : o.email;
      newOrders.push({
        id: String(o.id),
        title: `#${o.order_number}`,
        subtitle: [who || 'Guest', `${(o.line_items || []).length} item${(o.line_items || []).length === 1 ? '' : 's'}`,
          o.financial_status, o.fulfillment_status || 'unfulfilled'].filter(Boolean).join(' · '),
        date: o.created_at,
        amount: parseFloat(o.total_price || '0'),
      });
    }

    const newCustomers: PullItem[] = [];
    for (const c of customers) {
      if (sets.customerDocIds.has(`shopify-${c.id}`) || sets.customerShopifyIds.has(String(c.id))) continue;
      newCustomers.push({
        id: String(c.id),
        title: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || `Customer ${c.id}`,
        subtitle: [c.email, c.phone].filter(Boolean).join(' · ') || undefined,
        date: c.created_at,
      });
    }

    // Products are listed per variant, because that is what becomes a POS SKU.
    const allNewProducts: PullItem[] = [];
    for (const p of products) {
      for (const v of (p.variants || [])) {
        const sku = v.sku || `SHOPIFY-PROD-${v.id}`;
        if (sets.productSkus.has(sku)) continue;
        const title = (p.variants || []).length > 1 ? `${p.title} — ${v.title}` : p.title;
        if (q && !title.toLowerCase().includes(q) && !sku.toLowerCase().includes(q)) continue;
        allNewProducts.push({
          id: `${p.id}:${v.id}`,
          title,
          subtitle: sku,
          amount: parseFloat(v.price || '0'),
        });
      }
    }
    const newProducts = allNewProducts.slice(0, PRODUCT_PAGE);

    const byDateDesc = (a: PullItem, b: PullItem) =>
      new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();

    return NextResponse.json({
      shop,
      orders: newOrders.sort(byDateDesc),
      customers: newCustomers.sort(byDateDesc),
      products: newProducts.sort((a, b) => a.title.localeCompare(b.title)),
      since,
      olderSkipped,
      totals: {
        orders: newOrders.length,
        customers: newCustomers.length,
        products: allNewProducts.length,
      },
      // The cap is reported rather than applied silently, so a partial list is
      // never mistaken for the whole catalogue.
      productsShown: newProducts.length,
      productsTruncated: allNewProducts.length > newProducts.length,
      query: q || undefined,
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
    const { orderIds = [], customerIds = [], productIds = [] } = await request.json();
    if (!orderIds.length && !customerIds.length && !productIds.length) {
      return NextResponse.json({ error: 'Nothing selected.' }, { status: 400 });
    }

    const { shop, token } = await getShopifyCredentials(adminDb);
    if (!shop || !token) return NextResponse.json({ error: 'Shopify not connected.' }, { status: 400 });

    const wantOrders = new Set(orderIds.map(String));
    const wantCustomers = new Set(customerIds.map(String));
    const wantProducts = new Set(productIds.map(String));
    const imported = { orders: 0, customers: 0, products: 0 };
    const errors: string[] = [];

    if (wantCustomers.size) {
      const all = await fetchAllPages(shop, token, '/customers.json', 'customers');
      for (const c of all) {
        if (!wantCustomers.has(String(c.id))) continue;
        try {
          await adminDb.collection('customers').doc(`shopify-${c.id}`).set(mapCustomer(c), { merge: true });
          imported.customers++;
        } catch (e: unknown) { errors.push(`Customer ${c.id}: ${(e as Error).message}`); }
      }
    }

    if (wantOrders.size) {
      const all = await fetchAllPages(shop, token, '/orders.json?status=any', 'orders');
      for (const o of all) {
        if (!wantOrders.has(String(o.id))) continue;
        // Defensive: the picker never offers pre-cutoff orders, so a request
        // for one means a stale page or a hand-made call — refuse rather than
        // quietly backfill history.
        if (Number(o.order_number) <= SINCE_ORDER_NUMBER) {
          errors.push(`Order #${o.order_number}: below the #${SINCE_ORDER_NUMBER} cutoff, skipped`);
          continue;
        }
        try {
          await adminDb.collection('invoices').doc(`SHOPIFY-${o.order_number}`).set(mapInvoice(o), { merge: true });
          imported.orders++;
        } catch (e: unknown) { errors.push(`Order #${o.order_number}: ${(e as Error).message}`); }
      }
    }

    if (wantProducts.size) {
      const all = await fetchAllPages(shop, token, '/products.json', 'products');
      for (const p of all) {
        for (const v of (p.variants || [])) {
          if (!wantProducts.has(`${p.id}:${v.id}`)) continue;
          const sku = v.sku || `SHOPIFY-PROD-${v.id}`;
          try {
            await adminDb.collection('products').doc(sku).set(mapProduct(p, v), { merge: true });
            imported.products++;
          } catch (e: unknown) { errors.push(`Product ${sku}: ${(e as Error).message}`); }
        }
      }
    }

    await adminDb.collection('app_settings').doc('global')
      .set({ shopifyLastSyncedAt: new Date().toISOString() }, { merge: true });

    return NextResponse.json({ success: true, imported, errors });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
