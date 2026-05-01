// Cleanup: revert Shopify to pre-auto-push state.
//
// Action 1 — Shopify: DELETE every order tagged `pos-import` (permanent).
// Action 2 — Firestore: strip shopifyOrderId / shopifyOrderNumber /
//            shopifyDraftOrderId / shopifyCheckoutUrl from the matching
//            POS invoice docs (POS Invoice INV-XXX referenced by the order's
//            `note` field). Does NOT delete any Firestore docs.
//
// Usage:
//   node scripts/cleanup-shopify-pos-orders.mjs              # dry run (default)
//   node scripts/cleanup-shopify-pos-orders.mjs --apply      # execute

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'hom-pos-52710474-ceeea';
const SHOPIFY_API_VERSION = '2026-01';

// ─── Firebase auth via firebase-tools refresh token ───
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
      const o = {};
      for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = walk(vv);
      return o;
    }
    return undefined;
  };
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = walk(v);
  out._id = doc.name.split('/').pop();
  return out;
}

async function getDocById(name, id) {
  const res = await fetch(`${FB_BASE}/${name}/${id}`, { headers: fbHeaders });
  if (!res.ok) return null;
  return extractFields(await res.json());
}

async function listInvoicesWithShopifyId() {
  const all = [];
  let pageToken = '';
  do {
    const url = `${FB_BASE}/invoices?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, { headers: fbHeaders });
    const data = await res.json();
    if (data.documents) all.push(...data.documents.map(extractFields));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return all;
}

// PATCH: omit fields from body but list them in updateMask → Firestore deletes them
async function stripShopifyFieldsOnInvoice(invoiceId) {
  const fields = ['shopifyOrderId', 'shopifyOrderNumber', 'shopifyDraftOrderId', 'shopifyCheckoutUrl'];
  const params = new URLSearchParams();
  for (const f of fields) params.append('updateMask.fieldPaths', f);
  const url = `${FB_BASE}/invoices/${invoiceId}?${params.toString()}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...fbHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {} }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firestore PATCH ${invoiceId}: ${res.status} ${t.slice(0, 200)}`);
  }
}

// ─── Shopify ───
const settings = await getDocById('app_settings', 'global');
const shop = process.env.SHOPIFY_STORE_DOMAIN || settings?.shopifyStoreDomain;
const token = process.env.SHOPIFY_ACCESS_TOKEN || settings?.shopifyAccessToken;
if (!shop || !token) { console.error('Shopify creds missing.'); process.exit(1); }

async function fetchAllShopify(endpoint, key) {
  const all = [];
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}?limit=250&status=any`;
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Shopify ${endpoint}: ${res.status} ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    all.push(...(data[key] || []));
    const link = res.headers.get('link');
    const m = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : '';
  }
  return all;
}

async function deleteShopifyOrder(id) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${id}.json`, {
    method: 'DELETE',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  });
  if (res.status === 200 || res.status === 204) return { ok: true };
  const t = await res.text();
  return { ok: false, status: res.status, body: t.slice(0, 300) };
}

async function cancelShopifyOrder(id) {
  // Used as fallback for orders that DELETE rejects (paid / has-transactions).
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${id}/cancel.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.ok) return { ok: true };
  const t = await res.text();
  return { ok: false, status: res.status, body: t.slice(0, 300) };
}

// ─── Build the work list ───
console.log(`Mode: ${APPLY ? 'APPLY (destructive)' : 'DRY RUN'}`);
console.log('Fetching Shopify orders + Firestore invoices...');

const [shopifyOrders, invoices] = await Promise.all([
  fetchAllShopify('/orders.json', 'orders'),
  listInvoicesWithShopifyId(),
]);

const POS_NOTE_RE = /POS Invoice (INV-[A-Za-z0-9-]+)/;
const invoicesById = new Map(invoices.map(i => [i._id, i]));

const targets = [];
for (const o of shopifyOrders) {
  const tags = (o.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!tags.includes('pos-import')) continue;
  const m = POS_NOTE_RE.exec(o.note || '');
  const posInvoiceId = m ? m[1] : null;
  const matchInvoice = posInvoiceId ? invoicesById.get(posInvoiceId) : null;
  // Some POS invoices in Firestore may have shopifyOrderId pointing to this order even without the note match
  const altMatchByShopifyId = invoices.find(inv =>
    inv.shopifyOrderId && String(inv.shopifyOrderId) === String(o.id) && !inv._id.startsWith('SHOPIFY-')
  );
  targets.push({
    shopifyOrderId: String(o.id),
    shopifyOrderNumber: o.order_number,
    total: parseFloat(o.total_price),
    financialStatus: o.financial_status,
    cancelledAt: o.cancelled_at,
    createdAt: o.created_at,
    posInvoiceIdFromNote: posInvoiceId,
    posInvoicePresent: !!matchInvoice,
    posInvoiceFromShopifyIdLink: altMatchByShopifyId?._id || null,
  });
}

console.log(`\nMatched ${targets.length} pos-import-tagged Shopify orders.`);
const alreadyCancelled = targets.filter(t => t.cancelledAt).length;
console.log(`  already cancelled (will still try DELETE): ${alreadyCancelled}`);

// Build invoice patch list (de-dup)
const invoiceIdsToStrip = new Set();
for (const t of targets) {
  if (t.posInvoicePresent) invoiceIdsToStrip.add(t.posInvoiceIdFromNote);
  if (t.posInvoiceFromShopifyIdLink) invoiceIdsToStrip.add(t.posInvoiceFromShopifyIdLink);
}
console.log(`Invoices to strip shopify* fields from: ${invoiceIdsToStrip.size}`);

console.log('\n--- Shopify orders to DELETE ---');
for (const t of targets) {
  const link = t.posInvoiceIdFromNote
    ? (t.posInvoicePresent ? `→ ${t.posInvoiceIdFromNote} (present)` : `→ ${t.posInvoiceIdFromNote} (gone from FS)`)
    : (t.posInvoiceFromShopifyIdLink ? `→ ${t.posInvoiceFromShopifyIdLink} (via shopifyOrderId link)` : '→ (no link)');
  const cx = t.cancelledAt ? '  [already cancelled]' : '';
  console.log(`  #${t.shopifyOrderNumber}  id=${t.shopifyOrderId}  total=${t.total}  ${t.financialStatus}  ${t.createdAt}  ${link}${cx}`);
}

console.log('\n--- Invoices to PATCH (strip shopify* fields) ---');
for (const id of invoiceIdsToStrip) {
  const inv = invoicesById.get(id);
  console.log(`  ${id}  ${inv?.customerName || '(?)'}  total=${inv?.grandTotal}  shopifyOrderId=${inv?.shopifyOrderId || ''}`);
}

if (!APPLY) {
  console.log('\nDRY RUN. Re-run with --apply to execute.');
  process.exit(0);
}

// ─── EXECUTE ───
console.log('\n=== APPLYING ===');
const results = { deleted: [], deleteFailed: [], patched: [], patchFailed: [] };

for (const t of targets) {
  process.stdout.write(`DELETE shopify order #${t.shopifyOrderNumber} (id=${t.shopifyOrderId}) ... `);
  const r = await deleteShopifyOrder(t.shopifyOrderId);
  if (r.ok) {
    console.log('ok');
    results.deleted.push(t);
  } else {
    console.log(`FAILED ${r.status} ${r.body}`);
    results.deleteFailed.push({ ...t, error: `${r.status} ${r.body}` });
  }
  // Modest pacing to respect Shopify rate limits (2 req/s leaky bucket on REST)
  await new Promise(res => setTimeout(res, 600));
}

for (const id of invoiceIdsToStrip) {
  process.stdout.write(`PATCH invoice ${id} ... `);
  try {
    await stripShopifyFieldsOnInvoice(id);
    console.log('ok');
    results.patched.push(id);
  } catch (e) {
    console.log(`FAILED ${e.message}`);
    results.patchFailed.push({ id, error: e.message });
  }
}

console.log('\n=== RESULT ===');
console.log(`Shopify deleted:  ${results.deleted.length}`);
console.log(`Shopify failed:   ${results.deleteFailed.length}`);
console.log(`Firestore patched:${results.patched.length}`);
console.log(`Firestore failed: ${results.patchFailed.length}`);

const out = 'scripts/cleanup-shopify-pos-orders.result.json';
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), ...results }, null, 2));
console.log(`Result written to ${out}`);

if (results.deleteFailed.length) {
  console.log('\nFailed deletes (Shopify only allows DELETE on un-paid orders without transactions):');
  for (const f of results.deleteFailed.slice(0, 10)) {
    console.log(`  #${f.shopifyOrderNumber}  id=${f.shopifyOrderId}  ${f.error}`);
  }
  console.log('\nRe-run with these IDs through cancel if you want them off the active list.');
}

process.exit(0);
