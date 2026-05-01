import crypto from 'crypto';

export const FIRESTORE_PROJECT_ID = 'hom-pos-52710474-ceeea';
export const FIRESTORE_API_KEY = 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4';
export const SHOPIFY_API_VERSION = '2026-01';
export const APP_URL = 'https://studio--hom-pos-52710474-ceeea.us-central1.hosted.app';

// --- Webhook HMAC validation ---
export function validateWebhookHmac(rawBody: string, hmacHeader: string, secret: string): boolean {
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

// --- Firestore REST helpers ---
function firestoreBase(collection: string, docId?: string) {
  const base = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
  return docId
    ? `${base}/${collection}/${docId}?key=${FIRESTORE_API_KEY}`
    : `${base}/${collection}?key=${FIRESTORE_API_KEY}`;
}

export async function firestoreGet(collection: string, docId: string) {
  const res = await fetch(firestoreBase(collection, docId));
  if (!res.ok) return null;
  return res.json();
}

export async function firestoreSet(collection: string, docId: string, fields: Record<string, any>) {
  await fetch(firestoreBase(collection, docId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

/** Run a Firestore structured query and return all matching document fields. */
export async function firestoreQuery(collection: string, field: string, value: string): Promise<any[]> {
  const base = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIRESTORE_API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: 'EQUAL',
          value: { stringValue: value },
        },
      },
    },
  };
  const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return [];
  const rows: any[] = await res.json();
  return rows.filter(r => r.document?.fields).map(r => r.document);
}

export function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') return { doubleValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return fields;
}

// --- Shopify paginated fetch ---
export async function fetchAllPages(shop: string, token: string, endpoint: string, key: string): Promise<any[]> {
  let results: any[] = [];
  let url = `${endpoint}?limit=250`;

  while (url) {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${url}`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) break;
    const data = await res.json();
    results = results.concat(data[key] || []);

    const linkHeader = res.headers.get('link');
    const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
    if (nextMatch) {
      try {
        const nextUrl = new URL(nextMatch[1]);
        url = nextUrl.pathname.replace(`/admin/api/${SHOPIFY_API_VERSION}`, '') + nextUrl.search;
      } catch { url = ''; }
    } else {
      url = '';
    }
  }
  return results;
}

// --- Data mappers ---
export function mapCustomer(sc: any) {
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

export function mapInvoiceItem(lineItem: any) {
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

export function mapInvoice(order: any) {
  const discount = parseFloat(order.total_discounts || '0');
  const grandTotal = parseFloat(order.total_price || '0');
  const isPaid = order.financial_status === 'paid' || order.financial_status === 'partially_paid';
  const amountPaid = isPaid ? grandTotal : 0;
  const items = (order.line_items || []).map(mapInvoiceItem);
  const subtotal = items.reduce((sum: number, item: { itemTotal?: number }) => sum + (item.itemTotal || 0), 0);
  const adjustmentsAmount = grandTotal - (subtotal - discount);
  const customerName = order.customer
    ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || order.email || 'Shopify Customer'
    : order.email || 'Shopify Customer';

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
    ...(adjustmentsAmount !== 0 && { adjustmentsAmount }),
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

// --- Shopify authenticated request helper ---
export async function shopifyRequest(
  shop: string,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: any
): Promise<any> {
  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`,
    {
      method,
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Shopify ${method} ${endpoint}: ${res.status} - ${JSON.stringify(err)}`);
  }
  if (method === 'DELETE') return null;
  return res.json();
}

// --- GraphQL admin API (for tag-based search) ---
export async function shopifyGraphQL(shop: string, token: string, query: string, variables?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Shopify GraphQL: ${res.status} ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  return data.data;
}

/**
 * Find an existing Shopify order by tag. Tag is the stable per-invoice handle:
 * `pos-inv-INV-000123`. Returns numeric order id (legacyResourceId) or null.
 *
 * Shopify's search index updates asynchronously after order create/update, so
 * we retry a few times with a short backoff. Tagged orders typically appear
 * within ~3s; we give it up to ~6s before giving up.
 */
export async function findShopifyOrderIdByTag(
  shop: string,
  token: string,
  tag: string,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<string | null> {
  const attempts = opts.attempts ?? 5;
  const delay = opts.delayMs ?? 1200;
  for (let i = 0; i < attempts; i++) {
    const data = await shopifyGraphQL(shop, token, `
      query findByTag($q: String!) {
        orders(first: 5, query: $q) {
          nodes { id legacyResourceId cancelledAt }
        }
      }
    `, { q: `tag:${tag}` });
    const nodes: Array<{ legacyResourceId: string; cancelledAt: string | null }> = data?.orders?.nodes || [];
    if (nodes.length > 0) {
      const live = nodes.find(n => !n.cancelledAt);
      return (live || nodes[0])?.legacyResourceId || null;
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

/**
 * Find an existing Shopify DRAFT order by tag. Tag is the stable per-order
 * handle: `pos-order-ORD-000123`.
 */
export async function findShopifyDraftOrderIdByTag(
  shop: string,
  token: string,
  tag: string,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<string | null> {
  const attempts = opts.attempts ?? 5;
  const delay = opts.delayMs ?? 1200;
  for (let i = 0; i < attempts; i++) {
    const data = await shopifyGraphQL(shop, token, `
      query findDraftByTag($q: String!) {
        draftOrders(first: 5, query: $q) {
          nodes { id legacyResourceId status }
        }
      }
    `, { q: `tag:${tag}` });
    const nodes: Array<{ legacyResourceId: string; status: string }> = data?.draftOrders?.nodes || [];
    if (nodes.length > 0) {
      // Prefer OPEN drafts; INVOICE_SENT is also live; COMPLETED is consumed.
      const live = nodes.find(n => n.status === 'OPEN' || n.status === 'INVOICE_SENT');
      return (live || nodes[0])?.legacyResourceId || null;
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

/**
 * Build a Shopify draft-order payload from a POS order. Used for in-progress
 * orders that haven't been finalized into an invoice yet. Drafts are fully
 * editable, so PUT updates are safe.
 */
export function buildShopifyDraftOrderPayload(
  order: any,
  opts: { shopifyCustomerId?: string } = {}
) {
  const lineItems = (order.items || []).map((item: any, i: number) => {
    const price = (item.totalEstimate || item.manualPrice || 0);
    return {
      title: item.description || `Order Item ${i + 1}`,
      price: Number(price).toFixed(2),
      quantity: 1,
      ...(item.referenceSku && { sku: item.referenceSku }),
    };
  });
  const tags = ['pos-order', `pos-order-${order.id}`];
  const advance = (order.advancePayment || 0) + (order.advanceInExchangeValue || 0);
  const noteParts = [`POS Order ${order.id}`];
  if (advance > 0) noteParts.push(`Advance: ${advance}`);
  if (order.advanceInExchangeDescription) noteParts.push(`Exchange: ${order.advanceInExchangeDescription}`);
  if (order.summary) noteParts.push(order.summary);
  return {
    draft_order: {
      line_items: lineItems,
      ...(opts.shopifyCustomerId && { customer: { id: Number(opts.shopifyCustomerId) } }),
      tags: tags.join(','),
      note: noteParts.join(' | '),
      use_customer_default_address: false,
    },
  };
}

/**
 * Build a Shopify order create payload from a POS invoice. Tags include the
 * stable per-invoice handle so future searches can find this order.
 */
export function buildShopifyOrderPayload(
  invoice: any,
  opts: { shopifyCustomerId?: string; tags?: string[] } = {}
) {
  const lineItems = (invoice.items || []).map((item: any) => ({
    title: item.name || 'POS Item',
    price: ((item.itemTotal || 0) / (item.quantity || 1)).toFixed(2),
    quantity: item.quantity || 1,
    ...(item.sku && { sku: item.sku }),
  }));
  const tags = ['pos-import', `pos-inv-${invoice.id}`];
  if (invoice.sourceOrderId) tags.push(`pos-order-${invoice.sourceOrderId}`);
  if (opts.tags) tags.push(...opts.tags);
  const isPaid = (invoice.balanceDue || 0) <= 0 && (invoice.amountPaid || 0) > 0;
  const isPartiallyPaid = !isPaid && (invoice.amountPaid || 0) > 0;
  const financialStatus = isPaid ? 'paid' : (isPartiallyPaid ? 'partially_paid' : 'pending');
  return {
    order: {
      line_items: lineItems,
      financial_status: financialStatus,
      note: `POS Invoice ${invoice.id}`,
      ...(opts.shopifyCustomerId && { customer: { id: Number(opts.shopifyCustomerId) } }),
      ...(invoice.discountAmount > 0 && {
        discount_codes: [{
          code: 'POS-DISCOUNT',
          amount: invoice.discountAmount.toFixed(2),
          type: 'fixed_amount',
        }],
      }),
      created_at: invoice.createdAt,
      tags: tags.join(','),
      send_receipt: false,
      send_fulfillment_receipt: false,
    },
  };
}

// --- Credential resolution ---
export async function getShopifyCredentials(adminDb: any): Promise<{ shop: string; token: string }> {
  let shop = process.env.SHOPIFY_STORE_DOMAIN ?? '';
  let token = process.env.SHOPIFY_ACCESS_TOKEN ?? '';
  if (!shop || !token) {
    const snap = await adminDb.collection('app_settings').doc('global').get();
    const d = snap.data() || {};
    shop = d.shopifyStoreDomain || '';
    token = d.shopifyAccessToken || '';
  }
  if (!shop || !token) throw new Error('Shopify not connected');
  return { shop, token };
}

// --- Reverse mappers (POS → Shopify) ---
export function mapCustomerToShopify(c: any, posCustomerId?: string) {
  const nameParts = (c.name || '').split(' ');
  const tags = ['pos-pushed'];
  if (posCustomerId) tags.push(`pos-customer-${posCustomerId}`);
  return {
    customer: {
      first_name: nameParts[0] || '',
      last_name: nameParts.slice(1).join(' ') || '',
      email: c.email || undefined,
      phone: c.phone || undefined,
      tags: tags.join(','),
      ...(c.address && { addresses: [{ address1: c.address }] }),
    },
  };
}

/** Find a Shopify customer by per-POS-id tag, then by email, then by phone. */
export async function findShopifyCustomerId(
  shop: string,
  token: string,
  opts: { posCustomerId?: string; email?: string; phone?: string }
): Promise<string | null> {
  // Try tag first (most reliable for already-pushed records)
  if (opts.posCustomerId) {
    try {
      const data = await shopifyGraphQL(shop, token, `
        query findCust($q: String!) { customers(first: 1, query: $q) { nodes { id legacyResourceId } } }
      `, { q: `tag:pos-customer-${opts.posCustomerId}` });
      const node = data?.customers?.nodes?.[0];
      if (node?.legacyResourceId) return String(node.legacyResourceId);
    } catch { /* fall through */ }
  }
  // Try email
  if (opts.email) {
    try {
      const r = await shopifyRequest(shop, token, 'GET', `/customers/search.json?query=email:${encodeURIComponent(opts.email)}`);
      const c = r?.customers?.[0];
      if (c?.id) return String(c.id);
    } catch { /* */ }
  }
  // Try phone
  if (opts.phone) {
    try {
      const r = await shopifyRequest(shop, token, 'GET', `/customers/search.json?query=phone:${encodeURIComponent(opts.phone)}`);
      const c = r?.customers?.[0];
      if (c?.id) return String(c.id);
    } catch { /* */ }
  }
  return null;
}

export function mapInvoiceToDraftOrder(invoice: any, shopifyCustomerId?: string) {
  return {
    draft_order: {
      line_items: (invoice.items || []).map((item: any) => ({
        title: item.name,
        price: (item.itemTotal / (item.quantity || 1)).toFixed(2),
        quantity: item.quantity || 1,
        ...(item.sku && { sku: item.sku }),
      })),
      ...(shopifyCustomerId && { customer: { id: Number(shopifyCustomerId) } }),
      ...(invoice.discountAmount > 0 && {
        applied_discount: {
          value_type: 'fixed_amount',
          value: invoice.discountAmount.toFixed(2),
          description: 'POS Discount',
        },
      }),
      note: `POS Invoice ${invoice.id}`,
    },
  };
}

export function mapProductToShopify(p: any) {
  const price = p.isCustomPrice ? (p.customPrice || 0) : (p.makingCharges || 0);
  const tags = ['pos-pushed', `pos-product-${p.sku}`];
  return {
    product: {
      title: p.name,
      body_html: p.description || '',
      tags: tags.join(','),
      variants: [{
        price: price.toFixed(2),
        sku: p.sku,
        weight: p.metalWeightG || 0,
        weight_unit: 'g',
        inventory_management: null,
      }],
      ...(p.imageUrl && { images: [{ src: p.imageUrl }] }),
    },
  };
}

/** Find an existing Shopify product by SKU or per-POS tag. */
export async function findShopifyProductIdsBySku(
  shop: string,
  token: string,
  sku: string
): Promise<{ productId: string; variantId: string } | null> {
  try {
    const data = await shopifyGraphQL(shop, token, `
      query findProd($q: String!) {
        productVariants(first: 1, query: $q) {
          nodes { id legacyResourceId product { id legacyResourceId } }
        }
      }
    `, { q: `sku:${sku}` });
    const node = data?.productVariants?.nodes?.[0];
    if (node?.legacyResourceId && node?.product?.legacyResourceId) {
      return { productId: String(node.product.legacyResourceId), variantId: String(node.legacyResourceId) };
    }
  } catch { /* */ }
  return null;
}

export function mapProduct(sp: any, variant: any) {
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
