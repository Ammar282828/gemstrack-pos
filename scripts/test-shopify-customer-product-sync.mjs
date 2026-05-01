// Phase C: customer + product push idempotency tests.

import { readFileSync } from 'fs';
import { homedir } from 'os';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const PROJECT_ID = 'hom-pos-52710474-ceeea';
const SHOPIFY_API_VERSION = '2026-01';
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

async function shopifyGraphQL(query, vars) {
  const r = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: vars }),
  });
  const d = await r.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors));
  return d.data;
}

async function findCustomerByTag(tag, retries = 6, delayMs = 1500) {
  for (let i = 0; i < retries; i++) {
    const d = await shopifyGraphQL(
      `query($q: String!) { customers(first: 5, query: $q) { nodes { id legacyResourceId email phone } } }`,
      { q: `tag:${tag}` }
    );
    const nodes = d?.customers?.nodes || [];
    if (nodes.length > 0) return nodes;
    if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return [];
}

async function findCustomerByEmail(email) {
  const r = await shopify('GET', `/customers/search.json?query=${encodeURIComponent('email:' + email)}`);
  return r?.customers || [];
}

async function pushCustomer(customerId) {
  const r = await fetch(`${APP_URL}/api/shopify/push/customer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId }),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

async function pushProduct(sku) {
  const r = await fetch(`${APP_URL}/api/shopify/push/product`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku }),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

const createdCustIds = new Set(); // POS customer ids
const createdShopifyCustIds = new Set(); // Shopify customer ids
const createdProdIds = new Set(); // POS SKUs
const createdShopifyProdIds = new Set();

const results = [];
function pass(n) { results.push({ n, s: 'PASS' }); console.log(`  ✓ ${n}`); }
function fail(n, m) { results.push({ n, s: 'FAIL', m }); console.log(`  ✗ ${n}  ← ${m}`); }
function assert(c, n, m) { if (c) pass(n); else fail(n, m); return c; }
function assertEq(a, e, n) { return assert(String(a) === String(e), n, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scenario(name, fn) {
  console.log(`\n[${name}]`);
  try { await fn(); }
  catch (e) { fail(name, `threw: ${e.message}`); }
}

console.log(`Running customer/product sync test suite (run id ${RUN_ID})\nApp: ${APP_URL}\nShopify: ${shop}\n`);

// ─── Customer scenarios ───

// C1. Create customer → pushed → tag present → shopifyCustomerId stored
await scenario('C1: push new customer → created on Shopify, link stored, tag set', async () => {
  const id = `cust-test-${RUN_ID}-1`;
  const email = `test-${RUN_ID}-1@example.com`;
  await fbSet('customers', id, { name: `Test C1 ${RUN_ID}`, email, phone: '', address: '' });
  createdCustIds.add(id);
  const r = await pushCustomer(id);
  assert(r.ok && r.body?.shopifyCustomerId, 'C1.api ok', JSON.stringify(r.body));
  createdShopifyCustIds.add(r.body.shopifyCustomerId);
  const got = await fbGet('customers', id);
  assertEq(got?.shopifyCustomerId, r.body.shopifyCustomerId, 'C1.shopifyCustomerId stored on POS doc');
  await sleep(2000); // let Shopify index the tag
  const tagged = await findCustomerByTag(`pos-customer-${id}`);
  assert(tagged.length === 1 && tagged[0].legacyResourceId === r.body.shopifyCustomerId, 'C1.tag findable', `found=${tagged.length}`);
});

// C2. Re-push same customer → PUT update, same Shopify id, no duplicate
await scenario('C2: re-push customer → PUT update, same id', async () => {
  const id = `cust-test-${RUN_ID}-2`;
  await fbSet('customers', id, { name: `Test C2 ${RUN_ID}`, email: `test-${RUN_ID}-2@example.com`, phone: '', address: '' });
  createdCustIds.add(id);
  const r1 = await pushCustomer(id);
  createdShopifyCustIds.add(r1.body.shopifyCustomerId);
  const r2 = await pushCustomer(id);
  assertEq(r2.body.shopifyCustomerId, r1.body.shopifyCustomerId, 'C2.same id');
});

// C3. shopifyCustomerId missing but email matches an existing Shopify customer → re-link, no dup
await scenario('C3: missing link + email match → re-link', async () => {
  const id = `cust-test-${RUN_ID}-3`;
  const email = `test-${RUN_ID}-3@example.com`;
  await fbSet('customers', id, { name: `Test C3 ${RUN_ID}`, email, phone: '', address: '' });
  createdCustIds.add(id);
  const r1 = await pushCustomer(id);
  const firstId = r1.body.shopifyCustomerId;
  createdShopifyCustIds.add(firstId);
  // Wipe link locally, simulating loss
  await fbSet('customers', id, { name: `Test C3 ${RUN_ID}`, email, phone: '', address: '' });
  await sleep(1500);
  const r2 = await pushCustomer(id);
  assertEq(r2.body.shopifyCustomerId, firstId, 'C3.relinked to same Shopify id');
  // Verify only one Shopify customer with that email
  const matches = await findCustomerByEmail(email);
  assertEq(matches.length, 1, 'C3.no duplicate by email');
});

// C4. Stale shopifyCustomerId (points to a deleted Shopify customer) → fall through to search/create
await scenario('C4: stale shopifyCustomerId → recreate', async () => {
  const id = `cust-test-${RUN_ID}-4`;
  await fbSet('customers', id, {
    name: `Test C4 ${RUN_ID}`,
    email: `test-${RUN_ID}-4@example.com`,
    phone: '',
    address: '',
    shopifyCustomerId: '999999999999',
  });
  createdCustIds.add(id);
  const r = await pushCustomer(id);
  assert(r.body.shopifyCustomerId && r.body.shopifyCustomerId !== '999999999999', 'C4.fresh id', JSON.stringify(r.body));
  createdShopifyCustIds.add(r.body.shopifyCustomerId);
});

// C5. shopify-* prefixed id → skipped (echo prevention)
await scenario('C5: shopify-prefixed id → skipped', async () => {
  const r = await pushCustomer('shopify-99999');
  assert(r.body?.skipped === true, 'C5.skipped', JSON.stringify(r.body));
});

// ─── Product scenarios ───

// P1. Create product → pushed → SKU lookup works
await scenario('P1: push new product → created, SKU lookup works', async () => {
  const sku = `TEST-SKU-${RUN_ID}-1`;
  await fbSet('products', sku, { sku, name: `Test P1 ${RUN_ID}`, makingCharges: 1000, metalWeightG: 5, isCustomPrice: false });
  createdProdIds.add(sku);
  const r = await pushProduct(sku);
  assert(r.ok && r.body?.shopifyProductId, 'P1.api ok', JSON.stringify(r.body));
  createdShopifyProdIds.add(r.body.shopifyProductId);
  const got = await fbGet('products', sku);
  assertEq(got?.shopifyProductId, r.body.shopifyProductId, 'P1.product id stored');
  assertEq(got?.shopifyVariantId, r.body.shopifyVariantId, 'P1.variant id stored');
});

// P2. Re-push same product → PUT update, same id
await scenario('P2: re-push product → same id', async () => {
  const sku = `TEST-SKU-${RUN_ID}-2`;
  await fbSet('products', sku, { sku, name: `Test P2 ${RUN_ID}`, makingCharges: 500, metalWeightG: 3, isCustomPrice: false });
  createdProdIds.add(sku);
  const r1 = await pushProduct(sku);
  createdShopifyProdIds.add(r1.body.shopifyProductId);
  const r2 = await pushProduct(sku);
  assertEq(r2.body.shopifyProductId, r1.body.shopifyProductId, 'P2.same id');
});

// P3. shopifyProductId missing but SKU matches existing Shopify product → re-link
await scenario('P3: missing link + SKU match → re-link', async () => {
  const sku = `TEST-SKU-${RUN_ID}-3`;
  await fbSet('products', sku, { sku, name: `Test P3 ${RUN_ID}`, makingCharges: 200, metalWeightG: 2, isCustomPrice: false });
  createdProdIds.add(sku);
  const r1 = await pushProduct(sku);
  const firstId = r1.body.shopifyProductId;
  createdShopifyProdIds.add(firstId);
  // Wipe link locally
  await fbSet('products', sku, { sku, name: `Test P3 ${RUN_ID}`, makingCharges: 200, metalWeightG: 2, isCustomPrice: false });
  await sleep(2000);
  const r2 = await pushProduct(sku);
  assertEq(r2.body.shopifyProductId, firstId, 'P3.relinked to same product');
});

// P4. Stale shopifyProductId → fresh create
await scenario('P4: stale shopifyProductId → recreate', async () => {
  const sku = `TEST-SKU-${RUN_ID}-4`;
  await fbSet('products', sku, { sku, name: `Test P4 ${RUN_ID}`, makingCharges: 100, metalWeightG: 1, isCustomPrice: false, shopifyProductId: '999999999999', shopifyVariantId: '999999999998' });
  createdProdIds.add(sku);
  const r = await pushProduct(sku);
  assert(r.body.shopifyProductId && r.body.shopifyProductId !== '999999999999', 'P4.fresh id', JSON.stringify(r.body));
  createdShopifyProdIds.add(r.body.shopifyProductId);
});

// P5. SHOPIFY-PROD-* prefix → skipped
await scenario('P5: SHOPIFY-PROD-* sku → skipped', async () => {
  const r = await pushProduct('SHOPIFY-PROD-99999');
  assert(r.body?.skipped === true, 'P5.skipped', JSON.stringify(r.body));
});

// ─── Cleanup ───
console.log('\n=== Cleanup ===');
let cust = 0, prod = 0;
for (const id of createdShopifyCustIds) {
  try { await shopify('DELETE', `/customers/${id}.json`); cust++; } catch {}
  await sleep(300);
}
for (const id of createdShopifyProdIds) {
  try { await shopify('DELETE', `/products/${id}.json`); prod++; } catch {}
  await sleep(300);
}
for (const id of createdCustIds) await fbDelete('customers', id);
for (const id of createdProdIds) await fbDelete('products', id);
console.log(`Cleaned ${cust} Shopify customers, ${prod} Shopify products, ${createdCustIds.size} POS customers, ${createdProdIds.size} POS products`);

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
