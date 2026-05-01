// Bulk-sync every unsynced POS invoice (and optionally in-progress order) to Shopify.
// Uses the new idempotent endpoints, paces at 1 req/sec, logs each result, and
// stops if too many errors stack up.
//
// Usage:
//   node scripts/bulk-sync-pos-to-shopify.mjs                 # dry run
//   node scripts/bulk-sync-pos-to-shopify.mjs --apply         # invoices only
//   node scripts/bulk-sync-pos-to-shopify.mjs --apply --include-orders  # also sync in-progress orders as drafts

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const INCLUDE_ORDERS = process.argv.includes('--include-orders');
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const PROJECT_ID = 'hom-pos-52710474-ceeea';
const PACE_MS = 1000;          // 1 request per second between invoices
const FAIL_FAST_AFTER = 5;     // bail if 5 consecutive failures

// ─── Firebase auth ───
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
    if (v.mapValue !== undefined) { const o = {}; for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = walk(vv); return o; }
    return undefined;
  };
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = walk(v);
  out._id = doc.name.split('/').pop();
  return out;
}

async function listAll(name) {
  const all = [];
  let pageToken = '';
  do {
    const url = `${FB_BASE}/${name}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const r = await fetch(url, { headers: fbHeaders });
    const d = await r.json();
    if (d.documents) all.push(...d.documents.map(extractFields));
    pageToken = d.nextPageToken || '';
  } while (pageToken);
  return all;
}

async function callInvoiceUpsert(invoiceId) {
  const r = await fetch(`${APP_URL}/api/shopify/sync/invoice`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId, action: 'upsert' }),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}
async function callOrderUpsert(orderId) {
  const r = await fetch(`${APP_URL}/api/shopify/sync/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, action: 'upsert' }),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} | App: ${APP_URL} | include-orders: ${INCLUDE_ORDERS}`);
console.log('Loading Firestore collections...');

const [invoices, orders] = await Promise.all([
  listAll('invoices'),
  INCLUDE_ORDERS ? listAll('orders') : Promise.resolve([]),
]);

// ─── Filter ───
const invoiceTargets = invoices.filter(inv => {
  if (inv._id.startsWith('SHOPIFY-')) return false;
  if (inv.source && String(inv.source).includes('shopify')) return false;
  if (inv.shopifyOrderId) return false;
  if (inv.status === 'Refunded') return false;
  if (!Array.isArray(inv.items) || inv.items.length === 0) return false;
  if (inv.items.every(it => !it || !((it.itemTotal ?? 0) > 0))) return false;
  return true;
}).sort((a, b) => String(a._id).localeCompare(String(b._id)));

const orderTargets = INCLUDE_ORDERS ? orders.filter(o => {
  if (o.invoiceId) return false;
  if (o.shopifyDraftOrderId) return false;
  if (o.status === 'Cancelled' || o.status === 'Refunded') return false;
  if (!Array.isArray(o.items) || o.items.length === 0) return false;
  return true;
}).sort((a, b) => String(a._id).localeCompare(String(b._id))) : [];

console.log(`\nUnsynced POS invoices: ${invoiceTargets.length}`);
console.log(`Unsynced in-progress orders: ${orderTargets.length}`);
const totalRevenue = invoiceTargets.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0);
console.log(`Total invoice revenue to sync: PKR ${totalRevenue.toLocaleString()}\n`);

console.log('--- Invoices to upsert ---');
for (const inv of invoiceTargets) {
  console.log(`  ${inv._id}  ${(inv.customerName || '').padEnd(28)} total=${inv.grandTotal}  paid=${inv.amountPaid}  ${inv.createdAt}`);
}
if (orderTargets.length) {
  console.log('\n--- In-progress orders to upsert (as Shopify drafts) ---');
  for (const o of orderTargets) {
    console.log(`  ${o._id}  ${(o.customerName || '').padEnd(28)} total=${o.grandTotal}  status=${o.status}  ${o.createdAt}`);
  }
}

if (!APPLY) {
  console.log('\nDRY RUN. Re-run with --apply to execute.');
  process.exit(0);
}

// ─── Execute ───
console.log('\n=== APPLYING (paced 1 req/sec) ===\n');
const results = { invoices: { synced: [], skipped: [], failed: [] }, orders: { synced: [], skipped: [], failed: [] } };
let consecutiveFails = 0;

async function pace() { await new Promise(r => setTimeout(r, PACE_MS)); }

for (let i = 0; i < invoiceTargets.length; i++) {
  const inv = invoiceTargets[i];
  process.stdout.write(`[${(i + 1).toString().padStart(3)}/${invoiceTargets.length}] ${inv._id}  ${(inv.customerName || '').slice(0, 24).padEnd(24)} ... `);
  try {
    const r = await callInvoiceUpsert(inv._id);
    if (!r.ok) {
      console.log(`FAIL ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      results.invoices.failed.push({ id: inv._id, status: r.status, body: r.body });
      consecutiveFails++;
    } else if (r.body?.skipped) {
      console.log(`skip (${r.body.reason})`);
      results.invoices.skipped.push({ id: inv._id, reason: r.body.reason });
      consecutiveFails = 0;
    } else {
      const sid = r.body?.shopifyOrderId;
      const num = r.body?.shopifyOrderNumber;
      const action = r.body?.action || 'ok';
      console.log(`${action}  → #${num ?? '?'} (${sid ?? '?'})`);
      results.invoices.synced.push({ id: inv._id, shopifyOrderId: sid, shopifyOrderNumber: num, action });
      consecutiveFails = 0;
    }
  } catch (e) {
    console.log(`ERROR ${e.message}`);
    results.invoices.failed.push({ id: inv._id, error: e.message });
    consecutiveFails++;
  }
  if (consecutiveFails >= FAIL_FAST_AFTER) {
    console.log(`\nAborting: ${FAIL_FAST_AFTER} consecutive failures.`);
    break;
  }
  await pace();
}

if (INCLUDE_ORDERS && consecutiveFails < FAIL_FAST_AFTER) {
  console.log('\n--- in-progress orders ---');
  for (let i = 0; i < orderTargets.length; i++) {
    const o = orderTargets[i];
    process.stdout.write(`[${(i + 1).toString().padStart(3)}/${orderTargets.length}] ${o._id}  ${(o.customerName || '').slice(0, 24).padEnd(24)} ... `);
    try {
      const r = await callOrderUpsert(o._id);
      if (!r.ok) {
        console.log(`FAIL ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
        results.orders.failed.push({ id: o._id, status: r.status, body: r.body });
        consecutiveFails++;
      } else if (r.body?.skipped) {
        console.log(`skip (${r.body.reason})`);
        results.orders.skipped.push({ id: o._id, reason: r.body.reason });
        consecutiveFails = 0;
      } else {
        const did = r.body?.shopifyDraftOrderId;
        console.log(`${r.body?.action || 'ok'}  → draft ${did ?? '?'}`);
        results.orders.synced.push({ id: o._id, shopifyDraftOrderId: did, action: r.body?.action });
        consecutiveFails = 0;
      }
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      results.orders.failed.push({ id: o._id, error: e.message });
      consecutiveFails++;
    }
    if (consecutiveFails >= FAIL_FAST_AFTER) {
      console.log(`\nAborting: ${FAIL_FAST_AFTER} consecutive failures.`);
      break;
    }
    await pace();
  }
}

// ─── Report ───
console.log('\n=== RESULT ===');
console.log(`Invoices synced: ${results.invoices.synced.length}  skipped: ${results.invoices.skipped.length}  failed: ${results.invoices.failed.length}`);
if (INCLUDE_ORDERS) console.log(`Orders synced:   ${results.orders.synced.length}  skipped: ${results.orders.skipped.length}  failed: ${results.orders.failed.length}`);

const out = `scripts/bulk-sync-pos-to-shopify.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), apply: APPLY, includeOrders: INCLUDE_ORDERS, results }, null, 2));
console.log(`\nFull log: ${out}`);

if (results.invoices.failed.length || results.orders.failed.length) {
  console.log('\nFailures (re-run after fixing each):');
  for (const f of results.invoices.failed) console.log(`  invoice ${f.id}: ${JSON.stringify(f).slice(0, 200)}`);
  for (const f of results.orders.failed) console.log(`  order ${f.id}: ${JSON.stringify(f).slice(0, 200)}`);
}
process.exit(0);
