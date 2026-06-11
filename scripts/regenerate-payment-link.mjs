// Regenerate a Shopify payment link for a customer's invoice with the new
// tax-exempt payload. Useful when a link was created with the old (tax'd)
// settings and you want to refresh it without waiting for deploy.
//
// Usage:
//   node scripts/regenerate-payment-link.mjs "Sakina Paliwala"
//   node scripts/regenerate-payment-link.mjs "Sakina Paliwala" --apply

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const query = args.filter(a => a !== '--apply')[0];
if (!query) {
  console.error('Usage: node scripts/regenerate-payment-link.mjs "<customer>" [--apply]');
  process.exit(1);
}

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const fbConfig = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: fbConfig.tokens.refresh_token,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  }),
});
const { access_token } = await tokenRes.json();
const FB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const H = { Authorization: `Bearer ${access_token}` };

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') { const fields = {}; for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv); return { mapValue: { fields } }; }
  return { stringValue: String(v) };
}
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
    const r = await fetch(`${FB}/${name}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`, { headers: H });
    const d = await r.json();
    if (d.documents) all.push(...d.documents.map(extractFields));
    pageToken = d.nextPageToken || '';
  } while (pageToken);
  return all;
}
async function patch(path, fields) {
  const params = new URLSearchParams();
  for (const f of Object.keys(fields)) params.append('updateMask.fieldPaths', f);
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) fsFields[k] = toFsValue(v);
  const r = await fetch(`${FB}/${path}?${params.toString()}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fsFields }),
  });
  if (!r.ok) throw new Error(`patch ${path}: ${r.status} ${(await r.text()).slice(0,200)}`);
}

// Shopify credentials — env first (matches src/app/api/shopify/_lib.ts:getShopifyCredentials),
// fall back to app_settings/global if env is empty.
let shop = process.env.SHOPIFY_STORE_DOMAIN || '';
let token = process.env.SHOPIFY_ACCESS_TOKEN || '';
if (!shop || !token) {
  try {
    const env = readFileSync('.env.local', 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (!m) continue;
      if (m[1] === 'SHOPIFY_STORE_DOMAIN' && !shop) shop = m[2].trim();
      if (m[1] === 'SHOPIFY_ACCESS_TOKEN' && !token) token = m[2].trim();
    }
  } catch {}
}
if (!shop || !token) {
  const appSettings = await fetch(`${FB}/app_settings/global`, { headers: H }).then(r => r.json()).then(extractFields);
  shop = shop || appSettings.shopifyStoreDomain || '';
  token = token || appSettings.shopifyAccessToken || '';
}
if (!shop || !token) { console.error('Shopify not connected — no env vars and not in app_settings/global'); process.exit(1); }
const SHOP_BASE = `https://${shop}/admin/api/2026-01`;
const SHOP_H = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\nShop: ${shop}`);

const re = new RegExp(query.split(/\s+/).join('.*'), 'i');
const invoices = await listAll('invoices');
const matched = invoices
  .filter(i => re.test(i.customerName || ''))
  .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

if (matched.length === 0) { console.log('No matching invoices.'); process.exit(0); }

console.log(`\nMatching invoices:`);
for (const inv of matched.slice(0, 10)) {
  console.log(`  ${inv._id}  ${inv.customerName}  total=${inv.grandTotal}  balance=${inv.balanceDue}  draftId=${inv.shopifyDraftOrderId || '-'}  checkoutUrl=${inv.shopifyCheckoutUrl ? 'yes' : 'no'}`);
}

// Prefer the invoice with grandTotal === 35000 (per user's note). Otherwise latest.
let target = matched.find(i => Number(i.grandTotal) === 35000) || matched[0];
console.log(`\nTarget: ${target._id} (${target.customerName})  total=${target.grandTotal}  existingDraft=${target.shopifyDraftOrderId || '-'}`);

// Resolve Shopify customer id
let shopifyCustomerId;
if (target.customerId) {
  const cs = await listAll(`customers`);
  const c = cs.find(x => x._id === target.customerId);
  if (c?.shopifyCustomerId) shopifyCustomerId = String(c.shopifyCustomerId);
}

// Build tax-exempt draft_order payload (mirrors mapInvoiceToDraftOrder in src/app/api/shopify/_lib.ts)
const payload = {
  draft_order: {
    line_items: (target.items || []).map(item => ({
      title: item.name,
      price: (Number(item.itemTotal || 0) / Number(item.quantity || 1)).toFixed(2),
      quantity: Number(item.quantity || 1),
      taxable: false,
      ...(item.sku && { sku: item.sku }),
    })),
    ...(shopifyCustomerId && { customer: { id: Number(shopifyCustomerId) } }),
    tax_exempt: true,
    taxes_included: true,
    ...(Number(target.discountAmount || 0) > 0 && {
      applied_discount: {
        value_type: 'fixed_amount',
        value: Number(target.discountAmount).toFixed(2),
        description: 'POS Discount',
      },
    }),
    note: `POS Invoice ${target._id}`,
  },
};

console.log(`\nDraft order payload:`);
console.log(JSON.stringify(payload, null, 2));

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply.'); process.exit(0); }

console.log('\n=== APPLYING ===');
let draftOrderId = target.shopifyDraftOrderId;
let checkoutUrl;

if (draftOrderId) {
  console.log(`PUT /draft_orders/${draftOrderId}.json`);
  const r = await fetch(`${SHOP_BASE}/draft_orders/${draftOrderId}.json`, {
    method: 'PUT', headers: SHOP_H, body: JSON.stringify(payload),
  });
  if (!r.ok) {
    console.error(`PUT failed ${r.status}, falling back to POST a new draft:`);
    console.error((await r.text()).slice(0, 500));
    draftOrderId = null;
  } else {
    const j = await r.json();
    checkoutUrl = j.draft_order.invoice_url;
    console.log(`Draft order updated. checkoutUrl=${checkoutUrl}`);
  }
}

if (!draftOrderId) {
  console.log(`POST /draft_orders.json`);
  const r = await fetch(`${SHOP_BASE}/draft_orders.json`, {
    method: 'POST', headers: SHOP_H, body: JSON.stringify(payload),
  });
  if (!r.ok) { console.error(`POST failed ${r.status}: ${await r.text()}`); process.exit(1); }
  const j = await r.json();
  draftOrderId = String(j.draft_order.id);
  checkoutUrl = j.draft_order.invoice_url;
  console.log(`Draft order created. id=${draftOrderId} checkoutUrl=${checkoutUrl}`);
}

await patch(`invoices/${target._id}`, {
  shopifyDraftOrderId: String(draftOrderId),
  shopifyCheckoutUrl: checkoutUrl,
});
console.log(`Invoice ${target._id} patched with new draft id + checkoutUrl.`);

const out = `scripts/regenerate-payment-link.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), invoiceId: target._id, draftOrderId, checkoutUrl, payload }, null, 2));
console.log(`\nLog: ${out}`);
console.log(`\nLink: ${checkoutUrl}`);
