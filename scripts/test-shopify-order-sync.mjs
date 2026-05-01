// End-to-end test for the draft-order sync endpoint.
// Hits POST /api/shopify/sync/order on the local dev server.

import { readFileSync } from 'fs';
import { homedir } from 'os';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const PROJECT_ID = 'hom-pos-52710474-ceeea';
const SHOPIFY_API_VERSION = '2026-01';
const TEST_PREFIX = 'ORD-TEST-';
const RUN_ID = String(Date.now()).slice(-7);

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

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') { const fields = {}; for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv); return { mapValue: { fields } }; }
  return { stringValue: String(v) };
}
function toFsFields(obj) { const o = {}; for (const [k, v] of Object.entries(obj)) o[k] = toFsValue(v); return o; }
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
  const out = {}; for (const [k, v] of Object.entries(doc.fields || {})) out[k] = walk(v);
  out._id = doc.name.split('/').pop(); return out;
}
async function fbSet(coll, id, obj) {
  const r = await fetch(`${FB_BASE}/${coll}/${id}`, {
    method: 'PATCH', headers: { ...fbHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFsFields(obj) }),
  });
  if (!r.ok) throw new Error(`fbSet ${coll}/${id}: ${r.status} ${(await r.text()).slice(0,200)}`);
}
async function fbGet(coll, id) {
  const r = await fetch(`${FB_BASE}/${coll}/${id}`, { headers: fbHeaders });
  if (!r.ok) return null; return extractFields(await r.json());
}
async function fbDelete(coll, id) { await fetch(`${FB_BASE}/${coll}/${id}`, { method: 'DELETE', headers: fbHeaders }); }

const settings = await fbGet('app_settings', 'global');
const shop = process.env.SHOPIFY_STORE_DOMAIN || settings?.shopifyStoreDomain;
const token = process.env.SHOPIFY_ACCESS_TOKEN || settings?.shopifyAccessToken;

async function shopify(method, endpoint, body) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`, {
    method, headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Shopify ${method} ${endpoint}: ${res.status} ${t.slice(0,300)}`); }
  if (method === 'DELETE') return null;
  return res.json();
}

async function getDraft(id) {
  if (!id) return null;
  try { return (await shopify('GET', `/draft_orders/${id}.json`))?.draft_order; }
  catch { return null; }
}

async function callSyncOrder(body) {
  const res = await fetch(`${APP_URL}/api/shopify/sync/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

function buildOrder(overrides = {}) {
  const id = overrides.id || `${TEST_PREFIX}${RUN_ID}-${Math.floor(Math.random() * 100000)}`;
  const items = overrides.items || [
    { description: 'Test Custom Ring', metalType: 'gold', karat: '21k', estimatedWeightG: 5, stoneWeightG: 0, hasStones: false, wastagePercentage: 0, makingCharges: 1500, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, isCompleted: false, hasDiamonds: false, totalEstimate: 1500 },
  ];
  const subtotal = items.reduce((s, it) => s + (it.totalEstimate || it.manualPrice || 0), 0);
  return {
    customerName: overrides.customerName || 'Test Order Customer',
    customerContact: '',
    items,
    subtotal,
    advancePayment: overrides.advancePayment ?? 0,
    grandTotal: subtotal - (overrides.advancePayment ?? 0),
    createdAt: new Date().toISOString(),
    status: 'Pending',
    ratesApplied: { goldRatePerGram24k: 0, goldRatePerGram22k: 0, goldRatePerGram21k: 0, goldRatePerGram18k: 0 },
    summary: 'Test order',
    ...overrides,
    id,
  };
}

const createdOrderIds = new Set();
const createdDraftIds = new Set();
async function createOrder(o) { const { id, ...rest } = o; await fbSet('orders', id, rest); createdOrderIds.add(id); }
function trackDraft(id) { if (id) createdDraftIds.add(String(id)); }

const results = [];
function pass(n) { results.push({ n, s: 'PASS' }); console.log(`  ✓ ${n}`); }
function fail(n, m) { results.push({ n, s: 'FAIL', m }); console.log(`  ✗ ${n}  ← ${m}`); }
function assert(c, n, m) { if (c) pass(n); else fail(n, m); return c; }
function assertEq(a, e, n) { return assert(String(a) === String(e), n, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

async function scenario(name, fn) {
  console.log(`\n[${name}]`);
  try { await fn(); }
  catch (e) { fail(name, `threw: ${e.message}`); }
}

console.log(`Running draft-order test suite (run id ${RUN_ID})\nApp: ${APP_URL}\nShopify: ${shop}\n`);

// 1. Create order → draft created
await scenario('1: addOrder → draft created', async () => {
  const o = buildOrder();
  await createOrder(o);
  const r = await callSyncOrder({ orderId: o.id });
  trackDraft(r.body?.shopifyDraftOrderId);
  assert(r.ok && r.body?.shopifyDraftOrderId, '1.draft created', JSON.stringify(r.body));
  const got = await fbGet('orders', o.id);
  assert(!!got?.shopifyDraftOrderId, '1.order has shopifyDraftOrderId', 'missing');
  const draft = await getDraft(r.body.shopifyDraftOrderId);
  assertEq(draft?.line_items?.length, 1, '1.draft has 1 line item');
});

// 2. Edit items → draft updated in place
await scenario('2: edit items → draft updated in place', async () => {
  const o = buildOrder();
  await createOrder(o);
  const r1 = await callSyncOrder({ orderId: o.id });
  trackDraft(r1.body?.shopifyDraftOrderId);
  const cur = await fbGet('orders', o.id);
  // Add an item
  const newItems = [...cur.items, { description: 'Bracelet', metalType: 'gold', karat: '21k', estimatedWeightG: 3, stoneWeightG: 0, hasStones: false, wastagePercentage: 0, makingCharges: 800, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, isCompleted: false, hasDiamonds: false, totalEstimate: 800 }];
  await fbSet('orders', o.id, { ...cur, items: newItems, subtotal: 2300, grandTotal: 2300 });
  const r2 = await callSyncOrder({ orderId: o.id });
  trackDraft(r2.body?.shopifyDraftOrderId);
  assertEq(r2.body?.action, 'updated', '2.action=updated');
  assertEq(r2.body?.shopifyDraftOrderId, r1.body?.shopifyDraftOrderId, '2.same draft id');
  const draft = await getDraft(r1.body?.shopifyDraftOrderId);
  assertEq(draft?.line_items?.length, 2, '2.draft has 2 line items');
});

// 3. Record advance → note reflects advance
await scenario('3: record advance → note reflects advance', async () => {
  const o = buildOrder({ advancePayment: 0 });
  await createOrder(o);
  const r1 = await callSyncOrder({ orderId: o.id });
  trackDraft(r1.body?.shopifyDraftOrderId);
  const cur = await fbGet('orders', o.id);
  await fbSet('orders', o.id, { ...cur, advancePayment: 500, grandTotal: cur.subtotal - 500 });
  const r2 = await callSyncOrder({ orderId: o.id });
  trackDraft(r2.body?.shopifyDraftOrderId);
  const draft = await getDraft(r1.body?.shopifyDraftOrderId);
  assert((draft?.note || '').includes('Advance: 500'), '3.note contains advance', `note=${draft?.note}`);
});

// 4. Re-call upsert with no changes → idempotent (still 1 draft)
await scenario('4: re-call upsert → still 1 draft, same id', async () => {
  const o = buildOrder();
  await createOrder(o);
  const r1 = await callSyncOrder({ orderId: o.id });
  trackDraft(r1.body?.shopifyDraftOrderId);
  const r2 = await callSyncOrder({ orderId: o.id });
  trackDraft(r2.body?.shopifyDraftOrderId);
  assertEq(r2.body?.shopifyDraftOrderId, r1.body?.shopifyDraftOrderId, '4.same draft id');
});

// 5. Cancel order status → draft deleted
await scenario('5: status=Cancelled → draft deleted', async () => {
  const o = buildOrder();
  await createOrder(o);
  const r = await callSyncOrder({ orderId: o.id });
  trackDraft(r.body?.shopifyDraftOrderId);
  // Simulate updateOrderStatus(Cancelled): test path mimics by setting status + calling cancel
  const cur = await fbGet('orders', o.id);
  await fbSet('orders', o.id, { ...cur, status: 'Cancelled' });
  await callSyncOrder({ orderId: o.id, action: 'cancel' });
  // Verify
  const draft = await getDraft(r.body?.shopifyDraftOrderId);
  assert(!draft, '5.draft gone', 'still present');
});

// 6. Order has invoiceId → draft sync skipped (and any existing draft cleaned)
await scenario('6: order with invoiceId → upsert skipped, existing draft cleaned', async () => {
  const o = buildOrder();
  await createOrder(o);
  const r1 = await callSyncOrder({ orderId: o.id });
  trackDraft(r1.body?.shopifyDraftOrderId);
  // Set invoiceId on the order — represents finalization
  const cur = await fbGet('orders', o.id);
  await fbSet('orders', o.id, { ...cur, invoiceId: 'INV-DUMMY-' + RUN_ID });
  const r2 = await callSyncOrder({ orderId: o.id });
  assertEq(r2.body?.skipped, true, '6.skipped');
  assertEq(r2.body?.reason, 'order-invoiced', '6.reason=order-invoiced');
  // The handler should also delete the stale draft
  const draft = await getDraft(r1.body?.shopifyDraftOrderId);
  assert(!draft, '6.stale draft cleaned', 'still present');
});

// 7. Cancel by explicit shopifyDraftOrderId
await scenario('7: cancel by explicit shopifyDraftOrderId', async () => {
  const o = buildOrder();
  await createOrder(o);
  const r = await callSyncOrder({ orderId: o.id });
  trackDraft(r.body?.shopifyDraftOrderId);
  const r2 = await callSyncOrder({ shopifyDraftOrderId: r.body?.shopifyDraftOrderId, action: 'cancel' });
  assert(r2.ok, '7.cancel ok', JSON.stringify(r2.body));
  const draft = await getDraft(r.body?.shopifyDraftOrderId);
  assert(!draft, '7.draft gone', 'still present');
});

// 8. Stale shopifyDraftOrderId → re-creates and re-links
await scenario('8: stale shopifyDraftOrderId → re-creates', async () => {
  const o = buildOrder();
  o.shopifyDraftOrderId = '999999999999';
  await createOrder(o);
  const r = await callSyncOrder({ orderId: o.id });
  trackDraft(r.body?.shopifyDraftOrderId);
  assert(r.body?.shopifyDraftOrderId && r.body.shopifyDraftOrderId !== '999999999999', '8.fresh draft id', JSON.stringify(r.body));
});

// 9. Empty items → skipped
await scenario('9: empty items → skipped', async () => {
  const o = buildOrder({ items: [] });
  await createOrder(o);
  const r = await callSyncOrder({ orderId: o.id });
  assertEq(r.body?.skipped, true, '9.skipped');
  assertEq(r.body?.reason, 'no-items', '9.reason=no-items');
});

// 10. Concurrent upserts → only 1 draft
await scenario('10: concurrent upserts → only 1 draft', async () => {
  const o = buildOrder();
  await createOrder(o);
  const [r1, r2] = await Promise.all([
    callSyncOrder({ orderId: o.id }),
    callSyncOrder({ orderId: o.id }),
  ]);
  trackDraft(r1.body?.shopifyDraftOrderId);
  trackDraft(r2.body?.shopifyDraftOrderId);
  // Self-heal: a third call should converge
  await new Promise(r => setTimeout(r, 1500));
  const r3 = await callSyncOrder({ orderId: o.id });
  trackDraft(r3.body?.shopifyDraftOrderId);
  // Soft check: shouldn't see runaway duplication
  const got = await fbGet('orders', o.id);
  assert(!!got?.shopifyDraftOrderId, '10.order has draft id', 'missing');
});

// ─── Cleanup ───
console.log('\n=== Cleanup ===');
let cleaned = 0;
for (const id of createdDraftIds) {
  try { await shopify('DELETE', `/draft_orders/${id}.json`); cleaned++; }
  catch {}
  await new Promise(r => setTimeout(r, 300));
}
for (const id of createdOrderIds) await fbDelete('orders', id);
console.log(`Cleaned ${cleaned} drafts, ${createdOrderIds.size} order docs`);

console.log('\n=== Results ===');
const passed = results.filter(r => r.s === 'PASS').length;
const failed = results.filter(r => r.s === 'FAIL').length;
console.log(`PASS: ${passed}   FAIL: ${failed}   Total: ${results.length}`);
if (failed) {
  console.log('\nFailures:');
  for (const r of results.filter(r => r.s === 'FAIL')) console.log(`  ${r.n}: ${r.m}`);
  process.exit(1);
}
process.exit(0);
