// Import specific Shopify orders (by order_number) into the House of MINA POS
// as SHOPIFY-{order_number} invoices. Mirrors scripts/import-latest-shopify-order.mjs.
//
//   node scripts/import-shopify-orders-by-number.mjs 1373 1374 1379            # dry
//   node scripts/import-shopify-orders-by-number.mjs 1373 1374 1379 --apply

import { readFileSync } from 'fs';
import { homedir } from 'os';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const WANTED = new Set(args.filter(a => /^\d+$/.test(a)).map(Number));
if (!WANTED.size) { console.error('Usage: node scripts/import-shopify-orders-by-number.mjs <orderNumber...> [--apply]'); process.exit(1); }

const PROJECT_ID = 'hom-pos-52710474-ceeea'; // MINA (House of Mina)
const SHOPIFY_API_VERSION = '2026-01';

const _fetch = globalThis.fetch;
async function fetch(url, opts) {
  let last;
  for (let i = 1; i <= 6; i++) {
    try { return await _fetch(url, opts); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 700 * i)); }
  }
  throw last;
}

// ── Firebase auth ──
const fb = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: fb.tokens.refresh_token,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  }),
}).then(r => r.json());
const H = { Authorization: `Bearer ${tok.access_token}` };
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; for (const [k, vv] of Object.entries(v)) f[k] = toFs(vv); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function ext(doc) {
  const walk = (v) => {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.timestampValue !== undefined) return v.timestampValue;
    if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(walk);
    if (v.mapValue !== undefined) { const o = {}; for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = walk(vv); return o; }
    return undefined;
  };
  const o = {}; for (const [k, v] of Object.entries(doc.fields || {})) o[k] = walk(v);
  o._id = doc.name.split('/').pop(); return o;
}
async function getDocById(coll, id) {
  const r = await fetch(`${BASE}/${coll}/${id}`, { headers: H });
  if (!r.ok) return null;
  return ext(await r.json());
}
async function listAll(coll) {
  const all = []; let pt = '';
  do {
    const d = await fetch(`${BASE}/${coll}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: H }).then(r => r.json());
    if (d.documents) all.push(...d.documents.map(ext));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}
async function setDoc(coll, id, obj) {
  const r = await fetch(`${BASE}/${coll}/${id}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toFs(v)])) }),
  });
  if (!r.ok) throw new Error(`set ${coll}/${id}: ${r.status} ${(await r.text()).slice(0, 300)}`);
}

// ── Shopify creds ──
const settings = await getDocById('app_settings', 'global');
let shop = process.env.SHOPIFY_STORE_DOMAIN || settings?.shopifyStoreDomain || '';
let token = process.env.SHOPIFY_ACCESS_TOKEN || settings?.shopifyAccessToken || '';
if (!shop || !token) {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/); if (!m) continue;
      if (m[1] === 'SHOPIFY_STORE_DOMAIN' && !shop) shop = m[2].trim();
      if (m[1] === 'SHOPIFY_ACCESS_TOKEN' && !token) token = m[2].trim();
    }
  } catch {}
}
if (!shop || !token) { console.error('Shopify creds missing'); process.exit(1); }

// Fetch recent orders and pick the wanted numbers
const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=100&status=any&order=created_at+desc`;
const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } });
if (!res.ok) { console.error(`Shopify orders: ${res.status} ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const orders = ((await res.json()).orders || []).filter(o => WANTED.has(o.order_number));
const found = new Set(orders.map(o => o.order_number));
for (const n of WANTED) if (!found.has(n)) console.log(`⚠️  order #${n} not found in the last 100 orders`);

const invoices = await listAll('invoices');
const haveShopifyIds = new Set(invoices.map(i => String(i.shopifyOrderId || '')).filter(Boolean));

function mapItem(li) {
  const price = parseFloat(li.price || '0'); const qty = li.quantity || 1;
  return {
    sku: li.sku || `SHOPIFY-${li.id}`, name: li.name || li.title || 'Shopify Item',
    categoryId: '', metalType: 'gold', karat: '21k', metalWeightG: 0, stoneWeightG: 0,
    quantity: qty, unitPrice: price, itemTotal: price * qty,
    metalCost: 0, wastageCost: 0, wastagePercentage: 0, makingCharges: price * qty,
    diamondChargesIfAny: 0, stoneChargesIfAny: 0, miscChargesIfAny: 0,
  };
}

console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}   →  MINA POS (${PROJECT_ID})\n`);
const plans = [];
for (const order of orders.sort((a, b) => a.order_number - b.order_number)) {
  const discount = parseFloat(order.total_discounts || '0');
  const grandTotal = parseFloat(order.total_price || '0');
  const isPaid = order.financial_status === 'paid' || order.financial_status === 'partially_paid';
  const amountPaid = order.financial_status === 'paid' ? grandTotal : (order.financial_status === 'partially_paid' ? parseFloat(order.total_price) - parseFloat(order.total_outstanding || '0') : 0);
  const items = (order.line_items || []).map(mapItem);
  const subtotal = items.reduce((s, it) => s + it.itemTotal, 0);
  const adjustmentsAmount = grandTotal - (subtotal - discount);
  const customerName = order.customer ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || order.email || 'Shopify Customer' : order.email || 'Shopify Customer';
  const invoiceId = `SHOPIFY-${order.order_number}`;
  const already = haveShopifyIds.has(String(order.id)) || invoices.some(i => i._id === invoiceId);

  const invoiceDoc = {
    id: invoiceId, shopifyOrderId: String(order.id), shopifyOrderNumber: order.order_number,
    customerName, customerId: order.customer ? `shopify-${order.customer.id}` : '',
    customerContact: order.customer?.phone || '', items, subtotal, discountAmount: discount,
    ...(adjustmentsAmount !== 0 && { adjustmentsAmount }),
    grandTotal, amountPaid, balanceDue: grandTotal - amountPaid, createdAt: order.created_at,
    ratesApplied: { goldRatePerGram24k: 0, goldRatePerGram22k: 0, goldRatePerGram21k: 0, goldRatePerGram18k: 0 },
    paymentHistory: amountPaid > 0 ? [{ amount: amountPaid, date: order.created_at, notes: `Shopify ${order.financial_status}` }] : [],
    source: 'shopify',
    shopifyFulfillment: order.fulfillment_status || 'unfulfilled',
    shopifyFinancialStatus: order.financial_status || '',
    notes: `Imported from Shopify Order #${order.order_number}. Status: ${order.financial_status}/${order.fulfillment_status || 'unfulfilled'}`,
  };
  let customerDoc = null, customerId = null;
  if (order.customer) {
    customerId = `shopify-${order.customer.id}`;
    customerDoc = {
      id: customerId, name: customerName, phone: order.customer.phone || '', email: order.customer.email || '',
      address: order.customer.default_address ? [order.customer.default_address.address1, order.customer.default_address.city].filter(Boolean).join(', ') : '',
      shopifyCustomerId: String(order.customer.id),
    };
  }
  plans.push({ invoiceId, order, invoiceDoc, customerDoc, customerId, already, items, grandTotal, amountPaid, customerName });

  console.log(`#${order.order_number}  ${invoiceId}  ${already ? '⏭  ALREADY IN POS' : '🆕 NEW'}`);
  console.log(`   customer: ${customerName}${order.customer?.phone ? '  ' + order.customer.phone : ''}`);
  items.forEach(it => console.log(`   • ${it.name}  x${it.quantity}  = ${it.itemTotal.toLocaleString()}`));
  console.log(`   total=${grandTotal.toLocaleString()}  paid=${amountPaid.toLocaleString()}  balance=${(grandTotal - amountPaid).toLocaleString()}  [${order.financial_status}/${order.fulfillment_status || 'unfulfilled'}]\n`);
}

if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }

console.log('=== APPLYING ===');
for (const p of plans) {
  if (p.already) { console.log(`${p.invoiceId}: skipped (already in POS)`); continue; }
  await setDoc('invoices', p.invoiceId, p.invoiceDoc);
  if (p.customerDoc && !(await getDocById('customers', p.customerId))) await setDoc('customers', p.customerId, p.customerDoc);
  console.log(`${p.invoiceId}: wrote invoice (${p.customerName}, ${p.grandTotal.toLocaleString()})`);
}
console.log('\nDone.');
