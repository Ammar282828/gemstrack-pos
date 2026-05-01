// Import a single Shopify order into the POS as a SHOPIFY-{order_number} invoice.
// Mirrors the mapInvoice logic from src/app/api/shopify/_lib.ts.
//
// Usage:
//   node scripts/import-one-shopify-order.mjs "<customer name>"           # dry run
//   node scripts/import-one-shopify-order.mjs "<customer name>" --apply   # write to Firestore

import { readFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const QUERY = args.filter(a => !a.startsWith('--')).join(' ').trim();
if (!QUERY) { console.error('Usage: node import-one-shopify-order.mjs "<customer name>" [--apply]'); process.exit(1); }

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const SHOPIFY_API_VERSION = '2026-01';

// ─── Firebase auth ───
const fbConfig = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const refreshToken = fbConfig.tokens.refresh_token;
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: fbConfig.tokens.client_id || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: fbConfig.tokens.client_secret || 'j9iVZfS8kkCEFUPaAeJV0sAi',
  }),
});
const { access_token } = await tokenRes.json();
if (!access_token) { console.error('Failed to get Firebase access token'); process.exit(1); }
const FB_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const fbHeaders = { Authorization: `Bearer ${access_token}` };

function extractFields(doc) {
  const walk = (v) => {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.timestampValue !== undefined) return v.timestampValue;
    if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(walk);
    if (v.mapValue !== undefined) {
      const o = {}; for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = walk(vv); return o;
    }
    return undefined;
  };
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = walk(v);
  out._id = doc.name.split('/').pop();
  return out;
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function toFsFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFsValue(v);
  return out;
}

async function getDocById(coll, id) {
  const r = await fetch(`${FB_BASE}/${coll}/${id}`, { headers: fbHeaders });
  if (!r.ok) return null;
  return extractFields(await r.json());
}

async function setDoc(coll, id, obj) {
  const url = `${FB_BASE}/${coll}/${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...fbHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFsFields(obj) }),
  });
  if (!res.ok) throw new Error(`set ${coll}/${id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

// ─── Shopify ───
const settings = await getDocById('app_settings', 'global');
const shop = process.env.SHOPIFY_STORE_DOMAIN || settings?.shopifyStoreDomain;
const token = process.env.SHOPIFY_ACCESS_TOKEN || settings?.shopifyAccessToken;
if (!shop || !token) { console.error('Shopify creds missing'); process.exit(1); }

async function shopifyAll(endpoint, key) {
  const all = [];
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}?limit=250&status=any`;
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`Shopify ${endpoint}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    all.push(...(data[key] || []));
    const link = res.headers.get('link');
    const m = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : '';
  }
  return all;
}

console.log(`Searching Shopify for orders matching: "${QUERY}"`);
const orders = await shopifyAll('/orders.json', 'orders');

const q = QUERY.toLowerCase();
const matches = orders.filter(o => {
  const cust = o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim().toLowerCase() : '';
  const email = (o.email || o.customer?.email || '').toLowerCase();
  return cust.includes(q) || email.includes(q);
});

if (matches.length === 0) { console.log('No Shopify orders matched.'); process.exit(0); }

console.log(`\n${matches.length} matching Shopify order(s):`);
for (const o of matches) {
  const cust = o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : '(no customer)';
  console.log(`  #${o.order_number}  id=${o.id}  ${cust}  total=${o.total_price}  ${o.financial_status}/${o.fulfillment_status || 'unfulfilled'}  ${o.created_at}`);
}

if (matches.length > 1) {
  console.log('\nMultiple matches — narrow the query and try again.');
  process.exit(0);
}

const order = matches[0];

// ─── Map order → invoice (mirrors src/app/api/shopify/_lib.ts mapInvoice) ───
function mapInvoiceItem(li) {
  const price = parseFloat(li.price || '0');
  const qty = li.quantity || 1;
  return {
    sku: li.sku || `SHOPIFY-${li.id}`,
    name: li.name || li.title || 'Shopify Item',
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

const discount = parseFloat(order.total_discounts || '0');
const grandTotal = parseFloat(order.total_price || '0');
const isPaid = order.financial_status === 'paid' || order.financial_status === 'partially_paid';
const amountPaid = isPaid ? grandTotal : 0;
const items = (order.line_items || []).map(mapInvoiceItem);
const subtotal = items.reduce((s, it) => s + (it.itemTotal || 0), 0);
const adjustmentsAmount = grandTotal - (subtotal - discount);
const customerName = order.customer
  ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || order.email || 'Shopify Customer'
  : order.email || 'Shopify Customer';

const invoiceId = `SHOPIFY-${order.order_number}`;
const invoiceDoc = {
  id: invoiceId,
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
  notes: `Imported from Shopify Order #${order.order_number}. Status: ${order.financial_status}/${order.fulfillment_status || 'unfulfilled'}`,
};

// Customer doc (matches mapCustomer)
let customerDoc = null;
let customerId = null;
if (order.customer) {
  customerId = `shopify-${order.customer.id}`;
  customerDoc = {
    id: customerId,
    name: [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || order.customer.email || 'Shopify Customer',
    phone: order.customer.phone || '',
    email: order.customer.email || '',
    address: order.customer.default_address
      ? [order.customer.default_address.address1, order.customer.default_address.city].filter(Boolean).join(', ')
      : '',
    shopifyCustomerId: String(order.customer.id),
  };
}

// Existence checks
const existingInvoice = await getDocById('invoices', invoiceId);
const existingCustomer = customerId ? await getDocById('customers', customerId) : null;

console.log(`\n--- WILL WRITE ---`);
console.log(`invoices/${invoiceId}  ${existingInvoice ? '(OVERWRITE)' : '(NEW)'}`);
console.log(`  customer: ${customerName}`);
console.log(`  items: ${items.length}  subtotal=${subtotal}  discount=${discount}  grandTotal=${grandTotal}  paid=${amountPaid}`);
if (customerDoc) {
  console.log(`customers/${customerId}  ${existingCustomer ? '(SKIP — exists)' : '(NEW)'}`);
  console.log(`  name=${customerDoc.name}  phone=${customerDoc.phone || '-'}  email=${customerDoc.email || '-'}`);
}

if (!APPLY) {
  console.log('\nDRY RUN. Re-run with --apply to write.');
  process.exit(0);
}

console.log('\n=== APPLYING ===');
await setDoc('invoices', invoiceId, invoiceDoc);
console.log(`wrote invoices/${invoiceId}`);
if (customerDoc && !existingCustomer) {
  await setDoc('customers', customerId, customerDoc);
  console.log(`wrote customers/${customerId}`);
}
console.log('\nDone.');
