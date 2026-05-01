// Compare POS revenue against Shopify revenue and report mismatches per invoice.
// Read-only.

import { readFileSync } from 'fs';
import { homedir } from 'os';

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const SHOPIFY_API_VERSION = '2026-01';

const fbConfig = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: fbConfig.tokens.refresh_token,
    client_id: fbConfig.tokens.client_id || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: fbConfig.tokens.client_secret || 'j9iVZfS8kkCEFUPaAeJV0sAi',
  }),
});
const { access_token } = await tokenRes.json();
const FB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const auth = { Authorization: `Bearer ${access_token}` };

function extract(d) {
  const w = (v) => v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : (v.doubleValue !== undefined ? v.doubleValue : (v.booleanValue !== undefined ? v.booleanValue : (v.arrayValue ? (v.arrayValue.values||[]).map(w) : (v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,vv])=>[k,w(vv)])) : null)))));
  return { _id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,w(v)])) };
}
async function listAll(name) {
  const all = [];
  let pt = '';
  do {
    const r = await fetch(`${FB}/${name}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: auth });
    const d = await r.json();
    if (d.documents) all.push(...d.documents.map(extract));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}

const settings = await (await fetch(`${FB}/app_settings/global`, { headers: auth })).json();
const shop = settings.fields.shopifyStoreDomain.stringValue;
const tok = settings.fields.shopifyAccessToken.stringValue;

async function shopifyAll(endpoint, key) {
  const all = [];
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}?limit=250&status=any`;
  while (url) {
    const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': tok } });
    if (!r.ok) throw new Error(`${r.status}`);
    const d = await r.json();
    all.push(...(d[key] || []));
    const link = r.headers.get('link');
    const m = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : '';
  }
  return all;
}

console.log('Loading POS invoices + Shopify orders...');
const [invoices, shopifyOrders] = await Promise.all([listAll('invoices'), shopifyAll('/orders.json', 'orders')]);

const POS_NOTE_RE = /POS Invoice (INV-[A-Za-z0-9-]+)/;
const fmt = (n) => `PKR ${Math.round(Number(n) || 0).toLocaleString()}`;

// Categorize
const posOriginated = invoices.filter(i => !i._id.startsWith('SHOPIFY-') && !(i.source && String(i.source).includes('shopify')));
const shopifyMirror = invoices.filter(i => i._id.startsWith('SHOPIFY-') || (i.source && String(i.source).includes('shopify')));

const shopifyById = new Map(shopifyOrders.map(o => [String(o.id), o]));
const shopifyByPosNote = new Map();
for (const o of shopifyOrders) {
  const m = POS_NOTE_RE.exec(o.note || '');
  if (m) shopifyByPosNote.set(m[1], o);
}
const shopifyTaggedPosImport = shopifyOrders.filter(o => (o.tags || '').split(',').map(t => t.trim()).includes('pos-import'));
const shopifyNative = shopifyOrders.filter(o => {
  const tags = (o.tags || '').split(',').map(t => t.trim());
  if (tags.includes('pos-import')) return false;
  if (tags.some(t => t.startsWith('pos-inv-'))) return false;
  return true;
});

// ─── POS-side aggregates ───
function isMoneyless(inv) {
  if (inv.status === 'Refunded') return true;
  if (!Array.isArray(inv.items) || inv.items.length === 0) return true;
  return false;
}
const posOriginatedActive = posOriginated.filter(i => !isMoneyless(i));
const posTotalRevenue = posOriginatedActive.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0);
const posTotalPaid = posOriginatedActive.reduce((s, i) => s + (Number(i.amountPaid) || 0), 0);
const posTotalBalance = posOriginatedActive.reduce((s, i) => s + (Number(i.balanceDue) || 0), 0);

// ─── Shopify-side aggregates ───
const liveShopify = shopifyOrders.filter(o => !o.cancelled_at);
const shopifyTotalRevenue = liveShopify.reduce((s, o) => s + parseFloat(o.total_price || '0'), 0);
const shopifyPosImportRevenue = liveShopify.filter(o => (o.tags || '').includes('pos-import'))
  .reduce((s, o) => s + parseFloat(o.total_price || '0'), 0);
const shopifyNativeRevenue = liveShopify.filter(o => !((o.tags || '').includes('pos-import')))
  .reduce((s, o) => s + parseFloat(o.total_price || '0'), 0);

console.log('\n========== TOTALS ==========');
console.log(`POS invoices in Firestore:`);
console.log(`  POS-originated (INV-*):      ${posOriginated.length}  active=${posOriginatedActive.length}`);
console.log(`  Shopify-sourced mirror:      ${shopifyMirror.length}`);
console.log(`  Total invoices:              ${invoices.length}`);
console.log(`\nShopify orders:`);
console.log(`  Live (not cancelled):        ${liveShopify.length}`);
console.log(`  Tagged pos-import (POS push): ${shopifyTaggedPosImport.length}`);
console.log(`  Native Shopify:              ${shopifyNative.length}`);
console.log(`  Cancelled:                   ${shopifyOrders.length - liveShopify.length}`);

console.log('\n========== REVENUE ==========');
console.log(`POS (POS-originated, active):     ${fmt(posTotalRevenue).padStart(20)}  paid=${fmt(posTotalPaid)}  balance=${fmt(posTotalBalance)}`);
console.log(`Shopify (live, total revenue):    ${fmt(shopifyTotalRevenue).padStart(20)}`);
console.log(`  of which pos-import-tagged:     ${fmt(shopifyPosImportRevenue).padStart(20)}`);
console.log(`  of which native Shopify:        ${fmt(shopifyNativeRevenue).padStart(20)}`);

console.log('\n========== PER-INVOICE PARITY (POS-originated) ==========');
let mismatches = 0, unsynced = 0, matched = 0;
const breakdown = [];
for (const inv of posOriginatedActive) {
  const shopId = inv.shopifyOrderId ? String(inv.shopifyOrderId) : null;
  const linked = shopId ? shopifyById.get(shopId) : null;
  const fallback = !linked ? shopifyByPosNote.get(inv._id) : null;
  const order = linked || fallback;
  if (!order) {
    unsynced++;
    breakdown.push({ id: inv._id, customer: inv.customerName, status: 'UNSYNCED', posTotal: inv.grandTotal, shopifyTotal: null });
    continue;
  }
  const posTotal = Math.round((Number(inv.grandTotal) || 0) * 100);
  const shopTotal = Math.round(parseFloat(order.total_price || '0') * 100);
  if (posTotal === shopTotal) {
    matched++;
    breakdown.push({ id: inv._id, customer: inv.customerName, status: 'MATCH', posTotal: inv.grandTotal, shopifyTotal: parseFloat(order.total_price), shopifyOrderNumber: order.order_number });
  } else {
    mismatches++;
    breakdown.push({ id: inv._id, customer: inv.customerName, status: 'MISMATCH', posTotal: inv.grandTotal, shopifyTotal: parseFloat(order.total_price), shopifyOrderNumber: order.order_number });
  }
}

console.log(`Matched:    ${matched}`);
console.log(`Mismatched: ${mismatches}`);
console.log(`Unsynced:   ${unsynced}`);

if (mismatches > 0) {
  console.log('\nMismatches:');
  for (const b of breakdown.filter(x => x.status === 'MISMATCH')) {
    console.log(`  ${b.id}  ${(b.customer || '').padEnd(28)}  POS=${fmt(b.posTotal)}  Shopify=#${b.shopifyOrderNumber} ${fmt(b.shopifyTotal)}  diff=${fmt(b.posTotal - b.shopifyTotal)}`);
  }
}
if (unsynced > 0) {
  console.log('\nUnsynced POS invoices (no Shopify link):');
  for (const b of breakdown.filter(x => x.status === 'UNSYNCED').slice(0, 20)) {
    console.log(`  ${b.id}  ${(b.customer || '').padEnd(28)}  total=${fmt(b.posTotal)}`);
  }
}

console.log('\n========== SHOPIFY-SOURCED (mirror docs in POS) ==========');
let mirrorMatched = 0, mirrorMissingInShopify = 0;
for (const inv of shopifyMirror) {
  const shopId = inv.shopifyOrderId ? String(inv.shopifyOrderId) : null;
  if (!shopId) { mirrorMissingInShopify++; continue; }
  if (shopifyById.has(shopId)) mirrorMatched++;
  else mirrorMissingInShopify++;
}
console.log(`Mirror docs with live Shopify order:  ${mirrorMatched}`);
console.log(`Mirror docs whose Shopify order is gone (orphan): ${mirrorMissingInShopify}`);

console.log('\n========== POS-IMPORT WITHOUT MATCHING POS INVOICE (orphans on Shopify) ==========');
const posIds = new Set(posOriginated.map(i => i._id));
const orphans = shopifyTaggedPosImport.filter(o => {
  const m = POS_NOTE_RE.exec(o.note || '');
  return m && !posIds.has(m[1]);
});
console.log(`Orphans: ${orphans.length}`);
for (const o of orphans.slice(0, 10)) {
  const m = POS_NOTE_RE.exec(o.note || '');
  console.log(`  #${o.order_number}  id=${o.id}  note→${m?.[1]}  total=${o.total_price}  ${o.created_at}`);
}
