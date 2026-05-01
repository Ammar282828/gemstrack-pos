// Combined cleanup script:
//   1. Rename 3 POS customers to match their Shopify counterpart (mismatches).
//   2. Trim trailing whitespace on 3 POS customer names.
//   3. Fix YELLING-caps on 2 POS customer names ("Zara TAUFIQ" → "Zara Taufiq").
//   4. Push 16 unlinked POS customers to Shopify, then PUT their existing
//      Shopify orders to attach the customer record.
//
// All POS-side renames also propagate to invoices.customerName for invoices
// linked to those customers.
//
// Usage:
//   node scripts/fix-customer-cleanup.mjs              # dry run
//   node scripts/fix-customer-cleanup.mjs --apply

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const PROJECT_ID = 'hom-pos-52710474-ceeea';
const SHOPIFY_API_VERSION = '2026-01';

// ─── Plan ───
// Renames keyed by INVOICE so we can locate the right customer.
const RENAMES = [
  { invoiceId: 'INV-000177', newName: 'Sakina Hakim' },
  { invoiceId: 'INV-000189', newName: 'Amna Allahwala' },
  { invoiceId: 'INV-000202', newName: 'Sarah Noman' },
];

// Trims & caps: keyed by POS customer id.
const NAME_FIXES = [
  { customerId: 'cust-1774609145900', newName: 'Alifya' },
  { customerId: 'cust-1775471587526', newName: 'Sophia Shamoil' },
  { customerId: 'cust-1777293601870', newName: 'Sima Zaheer' },
  { customerId: 'cust-1776512151960', newName: 'Zara Taufiq' },
  { customerId: 'cust-1776512318534-3c5bv', newName: 'Zahra Taufiq' },
];

// Invoices whose Shopify order has no customer attached. The script pushes
// the linked POS customer (idempotent) and PUTs the order to attach.
const ATTACH_CUSTOMER_INVOICES = [
  'INV-000150', 'INV-000157', 'INV-000161', 'INV-000166', 'INV-000168',
  'INV-000180', 'INV-000182', 'INV-000184', 'INV-000185', 'INV-000187',
  'INV-000188', 'INV-000190', 'INV-000194', 'INV-000198', 'INV-000199',
  'INV-000200',
];

// ─── Setup ───
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
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; for (const [k,vv] of Object.entries(v)) f[k] = toFs(vv); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
async function fbGet(coll, id) {
  const r = await fetch(`${FB}/${coll}/${id}`, { headers: auth });
  if (!r.ok) return null;
  return extract(await r.json());
}
async function fbPatch(coll, id, fields) {
  const params = new URLSearchParams();
  for (const f of Object.keys(fields)) params.append('updateMask.fieldPaths', f);
  const fsFields = {}; for (const [k, v] of Object.entries(fields)) fsFields[k] = toFs(v);
  const r = await fetch(`${FB}/${coll}/${id}?${params.toString()}`, {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fsFields }),
  });
  if (!r.ok) throw new Error(`patch ${coll}/${id}: ${r.status} ${(await r.text()).slice(0,200)}`);
}
async function listAll(name) {
  const all = []; let pt = '';
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

async function shopify(method, endpoint, body) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`, {
    method, headers: { 'X-Shopify-Access-Token': tok, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Shopify ${method} ${endpoint}: ${res.status} ${t.slice(0,300)}`); }
  if (method === 'DELETE') return null;
  return res.json();
}

async function callPushCustomer(customerId) {
  const r = await fetch(`${APP_URL}/api/shopify/push/customer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId }),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

// ─── Resolve plan ───
console.log('\nLoading invoices + customers ...');
const [invoices, customers] = await Promise.all([listAll('invoices'), listAll('customers')]);
const invById = new Map(invoices.map(i => [i._id, i]));
const custById = new Map(customers.map(c => [c._id, c]));

// Resolve renames: invoiceId → customerId + invoice list
const renamePlan = [];
for (const r of RENAMES) {
  const inv = invById.get(r.invoiceId);
  if (!inv) { console.log(`  [skip rename] invoice ${r.invoiceId} not found`); continue; }
  const cid = inv.customerId;
  const oldName = inv.customerName;
  const cust = cid ? custById.get(cid) : null;
  // Find ALL invoices linked to this customer
  const linkedInvoices = cid ? invoices.filter(i => i.customerId === cid) : invoices.filter(i => i.customerName === oldName);
  renamePlan.push({ invoiceId: r.invoiceId, customerId: cid, oldName, newName: r.newName, customerExists: !!cust, linkedInvoices: linkedInvoices.map(i => i._id) });
}

// Resolve simple name fixes
const nameFixPlan = [];
for (const f of NAME_FIXES) {
  const cust = custById.get(f.customerId);
  if (!cust) { console.log(`  [skip name fix] ${f.customerId} not found`); continue; }
  const linkedInvoices = invoices.filter(i => i.customerId === f.customerId).map(i => i._id);
  nameFixPlan.push({ customerId: f.customerId, oldName: cust.name, newName: f.newName, linkedInvoices });
}

// Resolve customer-attach plan
const attachPlan = [];
for (const invId of ATTACH_CUSTOMER_INVOICES) {
  const inv = invById.get(invId);
  if (!inv) { console.log(`  [skip attach] ${invId} not found`); continue; }
  if (!inv.customerId) { console.log(`  [skip attach] ${invId} has no customerId`); continue; }
  if (!inv.shopifyOrderId) { console.log(`  [skip attach] ${invId} not on Shopify`); continue; }
  const cust = custById.get(inv.customerId);
  attachPlan.push({
    invoiceId: invId,
    customerId: inv.customerId,
    customerName: cust?.name || inv.customerName,
    customerEmail: cust?.email,
    customerPhone: cust?.phone || inv.customerContact,
    customerHasShopifyId: !!cust?.shopifyCustomerId,
    shopifyOrderId: String(inv.shopifyOrderId),
    shopifyOrderNumber: inv.shopifyOrderNumber,
  });
}

// ─── Show plan ───
console.log('\n=== RENAMES (POS → Shopify name parity) ===');
for (const p of renamePlan) {
  console.log(`  ${p.invoiceId}  customer=${p.customerId || '(none)'}  "${p.oldName}" → "${p.newName}"  linked invoices: ${p.linkedInvoices.length}`);
}
console.log('\n=== NAME CLEANUPS (whitespace + caps) ===');
for (const p of nameFixPlan) {
  console.log(`  ${p.customerId}  "${p.oldName}" → "${p.newName}"  linked invoices: ${p.linkedInvoices.length}`);
}
console.log('\n=== CUSTOMER ATTACH (Shopify orders missing customer) ===');
for (const p of attachPlan) {
  console.log(`  ${p.invoiceId}  → Shopify #${p.shopifyOrderNumber}  customer=${p.customerId} "${p.customerName}"  hasShopifyId=${p.customerHasShopifyId}`);
}

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to execute.'); process.exit(0); }

// ─── Apply ───
const results = { renamed: [], renameErrors: [], nameFixed: [], nameFixErrors: [], attached: [], attachErrors: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1) Renames
console.log('\n=== APPLY: RENAMES ===');
for (const p of renamePlan) {
  try {
    if (p.customerId && p.customerExists) {
      await fbPatch('customers', p.customerId, { name: p.newName });
      console.log(`  customer ${p.customerId}: name → "${p.newName}"`);
    }
    for (const invId of p.linkedInvoices) {
      await fbPatch('invoices', invId, { customerName: p.newName });
    }
    console.log(`  invoices renamed: ${p.linkedInvoices.length}`);
    results.renamed.push(p);
  } catch (e) {
    console.log(`  ERROR ${p.invoiceId}: ${e.message}`);
    results.renameErrors.push({ ...p, error: e.message });
  }
}

// 2) Name cleanups
console.log('\n=== APPLY: NAME CLEANUPS ===');
for (const p of nameFixPlan) {
  try {
    await fbPatch('customers', p.customerId, { name: p.newName });
    for (const invId of p.linkedInvoices) {
      await fbPatch('invoices', invId, { customerName: p.newName });
    }
    console.log(`  ${p.customerId}: "${p.oldName}" → "${p.newName}"  +${p.linkedInvoices.length} invoices`);
    results.nameFixed.push(p);
  } catch (e) {
    console.log(`  ERROR ${p.customerId}: ${e.message}`);
    results.nameFixErrors.push({ ...p, error: e.message });
  }
}

// 3) Push customers + attach to Shopify orders
console.log('\n=== APPLY: PUSH CUSTOMERS + ATTACH TO SHOPIFY ORDERS ===');
for (const p of attachPlan) {
  try {
    // Push customer (idempotent)
    const pr = await callPushCustomer(p.customerId);
    if (!pr.ok || !pr.body?.shopifyCustomerId) {
      console.log(`  push ${p.customerId}: FAIL ${pr.status} ${JSON.stringify(pr.body).slice(0,150)}`);
      results.attachErrors.push({ ...p, stage: 'push', error: pr.body });
      continue;
    }
    const scid = pr.body.shopifyCustomerId;
    await sleep(400);
    // PUT Shopify order to attach the customer
    await shopify('PUT', `/orders/${p.shopifyOrderId}.json`, {
      order: { id: Number(p.shopifyOrderId), customer: { id: Number(scid) } },
    });
    console.log(`  ${p.invoiceId} → #${p.shopifyOrderNumber}: pushed customer ${scid}, attached to order`);
    results.attached.push({ ...p, shopifyCustomerId: scid });
    await sleep(800);
  } catch (e) {
    console.log(`  ERROR ${p.invoiceId}: ${e.message}`);
    results.attachErrors.push({ ...p, error: e.message });
  }
}

console.log('\n=== RESULT ===');
console.log(`Renames: ${results.renamed.length} ok, ${results.renameErrors.length} errors`);
console.log(`Name fixes: ${results.nameFixed.length} ok, ${results.nameFixErrors.length} errors`);
console.log(`Attached customers: ${results.attached.length} ok, ${results.attachErrors.length} errors`);

const out = `scripts/fix-customer-cleanup.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`Log: ${out}`);
