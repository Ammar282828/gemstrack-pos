// Read-only audit of Shopify ↔ POS invoice state.
// Diagnoses the "every order edit creates a new Shopify order" bug.
//
// Usage: node scripts/audit-shopify-duplicates.mjs
// Output: scripts/audit-shopify-duplicates.report.json + summary to stdout.

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const SHOPIFY_API_VERSION = '2026-01';

// ─── Firestore (read-only via Firebase CLI token) ───
const fbConfig = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const refreshToken = fbConfig.tokens.refresh_token;
const clientId = fbConfig.tokens.client_id || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const clientSecret = fbConfig.tokens.client_secret || 'j9iVZfS8kkCEFUPaAeJV0sAi';

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: clientId, client_secret: clientSecret,
  }),
});
const { access_token } = await tokenRes.json();
if (!access_token) { console.error('Failed to get Firebase access token'); process.exit(1); }

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const fbHeaders = { Authorization: `Bearer ${access_token}` };

function extractFields(doc) {
  const out = {};
  const walk = (v) => {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.timestampValue !== undefined) return v.timestampValue;
    if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(walk);
    if (v.mapValue !== undefined) {
      const o = {};
      for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = walk(vv);
      return o;
    }
    return undefined;
  };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = walk(v);
  out._id = doc.name.split('/').pop();
  return out;
}

async function getCollection(name) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${name}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, { headers: fbHeaders });
    const data = await res.json();
    if (data.documents) docs.push(...data.documents);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs.map(extractFields);
}

async function getDocById(name, id) {
  const res = await fetch(`${BASE}/${name}/${id}`, { headers: fbHeaders });
  if (!res.ok) return null;
  const doc = await res.json();
  return extractFields(doc);
}

console.log('Fetching Firestore collections...');
const [invoices, orders, settings] = await Promise.all([
  getCollection('invoices'),
  getCollection('orders'),
  getDocById('app_settings', 'global'),
]);
console.log(`  invoices: ${invoices.length}`);
console.log(`  orders:   ${orders.length}`);

// ─── Shopify ───
const shop = process.env.SHOPIFY_STORE_DOMAIN || settings?.shopifyStoreDomain;
const token = process.env.SHOPIFY_ACCESS_TOKEN || settings?.shopifyAccessToken;
if (!shop || !token) {
  console.error('Shopify credentials not found. Set SHOPIFY_STORE_DOMAIN + SHOPIFY_ACCESS_TOKEN, or ensure app_settings/global has them.');
  process.exit(1);
}
console.log(`Fetching Shopify orders from ${shop}...`);

async function fetchAllShopify(endpoint, key) {
  const all = [];
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}?limit=250&status=any`;
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Shopify ${endpoint}: ${res.status} ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    all.push(...(data[key] || []));
    const link = res.headers.get('link');
    const m = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : '';
  }
  return all;
}

const shopifyOrders = await fetchAllShopify('/orders.json', 'orders');
console.log(`  shopify orders: ${shopifyOrders.length}`);

// ─── Analyses ───
const POS_NOTE_RE = /POS Invoice (INV-[A-Za-z0-9-]+)/;

// 1) Group Shopify orders by POS-invoice note → smoking-gun duplicates
const byPosInvoice = new Map(); // posInvoiceId -> array of shopify orders
const taggedPosImport = [];
const untagged = [];
for (const o of shopifyOrders) {
  const m = POS_NOTE_RE.exec(o.note || '');
  const tags = (o.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (tags.includes('pos-import')) taggedPosImport.push(o);
  if (m) {
    if (!byPosInvoice.has(m[1])) byPosInvoice.set(m[1], []);
    byPosInvoice.get(m[1]).push(o);
  } else {
    untagged.push(o);
  }
}

const duplicateSets = [...byPosInvoice.entries()].filter(([, arr]) => arr.length > 1);

// 2) For each POS invoice currently in Firestore — check if Shopify has more orders for it
const invoicesById = new Map(invoices.map(i => [i._id, i]));
const dupePerExistingInvoice = [];
for (const [posId, shopOrders] of byPosInvoice) {
  if (shopOrders.length <= 1) continue;
  const inv = invoicesById.get(posId);
  dupePerExistingInvoice.push({
    posInvoiceId: posId,
    posInvoicePresent: !!inv,
    posCustomer: inv?.customerName || null,
    posGrandTotal: inv?.grandTotal || null,
    posShopifyOrderId: inv?.shopifyOrderId || null,
    shopifyOrderCount: shopOrders.length,
    shopifyOrders: shopOrders.map(o => ({
      id: String(o.id),
      orderNumber: o.order_number,
      total: parseFloat(o.total_price),
      financialStatus: o.financial_status,
      cancelledAt: o.cancelled_at,
      createdAt: o.created_at,
      tags: o.tags,
    })),
  });
}

// 3) Orphans: POS invoices with shopifyOrderId pointing to a Shopify order that doesn't exist
const shopifyById = new Map(shopifyOrders.map(o => [String(o.id), o]));
const orphanInvoices = [];
for (const inv of invoices) {
  if (!inv.shopifyOrderId) continue;
  if (inv._id.startsWith('SHOPIFY-')) continue;
  if (!shopifyById.has(String(inv.shopifyOrderId))) {
    orphanInvoices.push({ invoiceId: inv._id, customerName: inv.customerName, grandTotal: inv.grandTotal, shopifyOrderId: inv.shopifyOrderId });
  }
}

// 4) Reverse orphans: Shopify orders whose POS-invoice note no longer exists in Firestore
const reverseOrphans = [];
for (const o of shopifyOrders) {
  if (o.cancelled_at) continue;
  const m = POS_NOTE_RE.exec(o.note || '');
  if (!m) continue;
  if (!invoicesById.has(m[1])) {
    reverseOrphans.push({
      shopifyOrderId: String(o.id),
      orderNumber: o.order_number,
      noteInvoiceId: m[1],
      total: parseFloat(o.total_price),
      financialStatus: o.financial_status,
      createdAt: o.created_at,
      tags: o.tags,
    });
  }
}

// 5) POS invoices that share customer+total with an existing SHOPIFY- doc (the dedup-target case)
const shopifyDocsInFs = invoices.filter(i => i._id.startsWith('SHOPIFY-') || (i.source && String(i.source).includes('shopify')));
const fingerprint = (i) => `${(i.customerName || '').toLowerCase().trim()}|${Math.round((i.grandTotal || 0) * 100)}`;
const shopifyFps = new Set(shopifyDocsInFs.map(fingerprint));
const possibleReentries = [];
for (const inv of invoices) {
  if (inv._id.startsWith('SHOPIFY-')) continue;
  if (inv.source && String(inv.source).includes('shopify')) continue;
  if (shopifyFps.has(fingerprint(inv))) {
    possibleReentries.push({ invoiceId: inv._id, customerName: inv.customerName, grandTotal: inv.grandTotal, shopifyOrderId: inv.shopifyOrderId || null });
  }
}

// 6) Group ALL pos-import-tagged Shopify orders by customer+total to surface non-noted duplicates
const shopByCustTotal = new Map();
for (const o of taggedPosImport) {
  const cust = ((o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : '') || o.email || '').toLowerCase().trim();
  const total = Math.round(parseFloat(o.total_price || '0') * 100);
  const k = `${cust}|${total}`;
  if (!shopByCustTotal.has(k)) shopByCustTotal.set(k, []);
  shopByCustTotal.get(k).push(o);
}
const customerTotalDupes = [...shopByCustTotal.entries()]
  .filter(([, arr]) => arr.length > 1)
  .map(([k, arr]) => ({
    fingerprint: k,
    count: arr.length,
    orders: arr.map(o => ({ id: String(o.id), orderNumber: o.order_number, total: parseFloat(o.total_price), createdAt: o.created_at, cancelledAt: o.cancelled_at, tags: o.tags, note: o.note })),
  }))
  .sort((a, b) => b.count - a.count);

// ─── Summary ───
const summary = {
  pos_invoices_in_firestore: invoices.length,
  pos_invoices_with_shopifyOrderId: invoices.filter(i => i.shopifyOrderId && !i._id.startsWith('SHOPIFY-')).length,
  shopify_total_orders: shopifyOrders.length,
  shopify_pos_import_tagged: taggedPosImport.length,
  shopify_with_pos_invoice_note: [...byPosInvoice.values()].reduce((s, a) => s + a.length, 0),
  shopify_cancelled: shopifyOrders.filter(o => o.cancelled_at).length,
  duplicate_sets_by_note: duplicateSets.length,
  total_duplicate_orders: duplicateSets.reduce((s, [, a]) => s + a.length - 1, 0),
  pos_invoices_with_orphan_shopifyOrderId: orphanInvoices.length,
  shopify_orders_with_dead_pos_note: reverseOrphans.length,
  possible_pos_reentries_of_shopify_orders: possibleReentries.length,
  pos_import_customer_total_duplicate_groups: customerTotalDupes.length,
};

console.log('\n=== SUMMARY ===');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(48)} ${v}`);

console.log('\n=== TOP 10 DUPLICATE-PER-POS-INVOICE SETS ===');
for (const d of dupePerExistingInvoice.slice(0, 10)) {
  console.log(`POS ${d.posInvoiceId}  | ${d.shopifyOrderCount}× shopify orders  | invoice ${d.posInvoicePresent ? 'PRESENT' : 'MISSING'}  | linked id: ${d.posShopifyOrderId || 'none'}`);
  for (const so of d.shopifyOrders) {
    const cancelled = so.cancelledAt ? '  CANCELLED' : '';
    console.log(`    #${so.orderNumber}  id=${so.id}  total=${so.total}  status=${so.financialStatus}  ${so.createdAt}${cancelled}`);
  }
}

console.log('\n=== TOP 10 CUSTOMER+TOTAL DUPLICATE GROUPS (pos-import tagged) ===');
for (const g of customerTotalDupes.slice(0, 10)) {
  console.log(`${g.fingerprint}  → ${g.count} orders`);
  for (const o of g.orders.slice(0, 5)) {
    const cancelled = o.cancelledAt ? '  CANCELLED' : '';
    console.log(`    #${o.orderNumber}  id=${o.id}  ${o.createdAt}${cancelled}  note: ${(o.note || '').slice(0, 60)}`);
  }
  if (g.orders.length > 5) console.log(`    ... ${g.orders.length - 5} more`);
}

if (orphanInvoices.length) {
  console.log('\n=== POS INVOICES WITH DEAD shopifyOrderId (top 10) ===');
  for (const o of orphanInvoices.slice(0, 10)) {
    console.log(`  ${o.invoiceId}  ${o.customerName}  total=${o.grandTotal}  shopifyOrderId=${o.shopifyOrderId} (not found in Shopify)`);
  }
}

if (reverseOrphans.length) {
  console.log('\n=== SHOPIFY ORDERS WITH POS-INVOICE-NOTE BUT INVOICE GONE FROM FIRESTORE (top 10) ===');
  for (const r of reverseOrphans.slice(0, 10)) {
    console.log(`  #${r.orderNumber}  id=${r.shopifyOrderId}  note→${r.noteInvoiceId}  total=${r.total}  ${r.createdAt}  tags=${r.tags}`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  summary,
  duplicate_sets_by_note: dupePerExistingInvoice,
  customer_total_dupes: customerTotalDupes,
  orphan_pos_invoices: orphanInvoices,
  reverse_orphan_shopify_orders: reverseOrphans,
  possible_pos_reentries: possibleReentries,
};

const outPath = 'scripts/audit-shopify-duplicates.report.json';
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nFull report written to ${outPath}`);

process.exit(0);
