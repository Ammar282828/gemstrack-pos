import { NextRequest, NextResponse } from 'next/server';

const FIRESTORE_PROJECT_ID = 'hom-pos-52710474-ceeea';
const FIRESTORE_API_KEY = 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4';
const SHOPIFY_API_VERSION = '2024-01';

// --- Firestore REST helpers ---
function firestoreUrl(collection: string, docId?: string) {
  const base = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
  return docId
    ? `${base}/${collection}/${docId}?key=${FIRESTORE_API_KEY}`
    : `${base}/${collection}?key=${FIRESTORE_API_KEY}`;
}

async function firestoreGet(collection: string, docId: string) {
  const res = await fetch(firestoreUrl(collection, docId));
  if (!res.ok) return null;
  return res.json();
}

async function firestoreSet(collection: string, docId: string, fields: Record<string, any>) {
  await fetch(firestoreUrl(collection, docId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') return { doubleValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

// --- Shopify API helpers ---
async function shopifyFetch(shop: string, token: string, path: string) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Shopify API error: ${res.status} ${path}`);
  return res.json();
}

async function fetchAllPages(shop: string, token: string, endpoint: string, key: string): Promise<any[]> {
  let results: any[] = [];
  let url = `${endpoint}?limit=250`;

  while (url) {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${url}`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) break;
    const data = await res.json();
    results = results.concat(data[key] || []);

    // Shopify cursor-based pagination via Link header
    const linkHeader = res.headers.get('link');
    const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
    if (nextMatch) {
      // Extract just the path + query from the full URL
      try {
        const nextUrl = new URL(nextMatch[1]);
        url = nextUrl.pathname.replace(`/admin/api/${SHOPIFY_API_VERSION}`, '') + nextUrl.search;
      } catch {
        url = '';
      }
    } else {
      url = '';
    }
  }
  return results;
}

// --- Data mappers ---
function mapCustomer(sc: any) {
  return {
    id: `shopify-${sc.id}`,
    name: [sc.first_name, sc.last_name].filter(Boolean).join(' ') || sc.email || 'Shopify Customer',
    phone: sc.phone || '',
    email: sc.email || '',
    address: sc.default_address
      ? [sc.default_address.address1, sc.default_address.city].filter(Boolean).join(', ')
      : '',
    shopifyCustomerId: String(sc.id),
  };
}

function mapInvoiceItem(lineItem: any, index: number) {
  const price = parseFloat(lineItem.price || '0');
  const qty = lineItem.quantity || 1;
  return {
    sku: lineItem.sku || `SHOPIFY-${lineItem.id}`,
    name: lineItem.name || lineItem.title || 'Shopify Item',
    categoryId: '',
    metalType: 'gold',
    karat: '21k',
    metalWeightG: 0,
    stoneWeightG: 0,
    quantity: qty,
    unitPrice: price,
    itemTotal: price * qty,
    metalCost: 0,
    wastageCost: 0,
    wastagePercentage: 0,
    makingCharges: price * qty,
    diamondChargesIfAny: 0,
    stoneChargesIfAny: 0,
    miscChargesIfAny: 0,
  };
}

function mapInvoice(order: any) {
  const subtotal = parseFloat(order.subtotal_price || '0');
  const discount = parseFloat(order.total_discounts || '0');
  const grandTotal = parseFloat(order.total_price || '0');
  const isPaid = order.financial_status === 'paid' || order.financial_status === 'partially_paid';
  const amountPaid = isPaid ? parseFloat(order.total_price || '0') : 0;
  const customerName = order.customer
    ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || order.email || 'Shopify Customer'
    : order.email || 'Shopify Customer';

  const items = (order.line_items || []).map(mapInvoiceItem);

  return {
    id: `SHOPIFY-${order.order_number}`,
    shopifyOrderId: String(order.id),
    shopifyOrderNumber: order.order_number,
    customerName,
    customerId: order.customer ? `shopify-${order.customer.id}` : '',
    customerContact: order.customer?.phone || '',
    items,
    subtotal,
    discountAmount: discount,
    grandTotal,
    amountPaid,
    balanceDue: grandTotal - amountPaid,
    createdAt: order.created_at,
    ratesApplied: { goldRatePerGram24k: 0, goldRatePerGram22k: 0, goldRatePerGram21k: 0, goldRatePerGram18k: 0 },
    paymentHistory: [],
    source: 'shopify',
    notes: `Imported from Shopify Order #${order.order_number}. Status: ${order.financial_status}`,
  };
}

function mapProduct(sp: any, variant: any) {
  const price = parseFloat(variant.price || '0');
  return {
    sku: variant.sku || `SHOPIFY-PROD-${variant.id}`,
    name: sp.variants?.length > 1 ? `${sp.title} - ${variant.title}` : sp.title,
    categoryId: '',
    metalType: 'gold',
    karat: '21k',
    metalWeightG: parseFloat(variant.weight || '0'),
    stoneWeightG: 0,
    hasStones: false,
    wastagePercentage: 0,
    makingCharges: price,
    hasDiamonds: false,
    diamondCharges: 0,
    stoneCharges: 0,
    miscCharges: 0,
    isCustomPrice: true,
    customPrice: price,
    imageUrl: sp.image?.src || '',
    description: sp.body_html?.replace(/<[^>]*>/g, '').slice(0, 200) || '',
    shopifyProductId: String(sp.id),
    shopifyVariantId: String(variant.id),
  };
}

// --- Main sync handler ---
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { syncOrders = true, syncCustomers = true, syncProducts = false } = body;

    // Get settings from Firestore
    const settingsDoc = await firestoreGet('app_settings', 'global');
    if (!settingsDoc?.fields) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 });
    }

    const shop = settingsDoc.fields.shopifyStoreDomain?.stringValue;
    const token = settingsDoc.fields.shopifyAccessToken?.stringValue;

    if (!shop || !token) {
      return NextResponse.json({ error: 'Shopify not connected. Please connect in Settings first.' }, { status: 400 });
    }

    const results = { orders: 0, customers: 0, products: 0, skipped: 0, errors: [] as string[] };

    // --- Sync Customers ---
    if (syncCustomers) {
      try {
        const shopifyCustomers = await fetchAllPages(shop, token, '/customers.json', 'customers');
        for (const sc of shopifyCustomers) {
          const customerId = `shopify-${sc.id}`;
          const existing = await firestoreGet('customers', customerId);
          if (!existing || existing.error) {
            await firestoreSet('customers', customerId, toFirestoreFields(mapCustomer(sc)));
            results.customers++;
          } else {
            results.skipped++;
          }
        }
      } catch (e: any) {
        results.errors.push(`Customers: ${e.message}`);
      }
    }

    // --- Sync Orders as Invoices ---
    if (syncOrders) {
      try {
        const shopifyOrders = await fetchAllPages(shop, token, '/orders.json?status=any', 'orders');
        for (const order of shopifyOrders) {
          const invoiceId = `SHOPIFY-${order.order_number}`;
          const existing = await firestoreGet('invoices', invoiceId);
          if (!existing || existing.error) {
            const invoice = mapInvoice(order);
            await firestoreSet('invoices', invoiceId, toFirestoreFields(invoice));
            results.orders++;
          } else {
            results.skipped++;
          }
        }
      } catch (e: any) {
        results.errors.push(`Orders: ${e.message}`);
      }
    }

    // --- Sync Products ---
    if (syncProducts) {
      try {
        const shopifyProducts = await fetchAllPages(shop, token, '/products.json', 'products');
        for (const sp of shopifyProducts) {
          for (const variant of (sp.variants || [])) {
            const sku = variant.sku || `SHOPIFY-PROD-${variant.id}`;
            const existing = await firestoreGet('products', sku);
            if (!existing || existing.error) {
              await firestoreSet('products', sku, toFirestoreFields(mapProduct(sp, variant)));
              results.products++;
            } else {
              results.skipped++;
            }
          }
        }
      } catch (e: any) {
        results.errors.push(`Products: ${e.message}`);
      }
    }

    // Update last synced timestamp
    await firestoreSet('app_settings', 'global', {
      shopifyLastSyncedAt: { stringValue: new Date().toISOString() },
    });

    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    console.error('Shopify sync error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
