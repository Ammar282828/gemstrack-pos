// Customer audit:
//   1. Parity check — POS invoices ↔ linked Shopify orders, are customer
//      names + phones consistent?
//   2. Weird name detector — surface POS customer/invoice records with
//      janky names (trailing whitespace, all-caps, looks-like-phone, blank,
//      near-duplicates of another customer).
//
// Read-only. Run separately to fix once findings are confirmed.

import { readFileSync, writeFileSync } from 'fs';
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

console.log('Loading POS + Shopify data...');
const [invoices, customers, shopifyOrders, shopifyCustomers] = await Promise.all([
  listAll('invoices'),
  listAll('customers'),
  shopifyAll('/orders.json', 'orders'),
  shopifyAll('/customers.json', 'customers'),
]);

const shopifyOrderById = new Map(shopifyOrders.map(o => [String(o.id), o]));
const shopifyCustById = new Map(shopifyCustomers.map(c => [String(c.id), c]));

function normalizePhone(p) {
  if (!p) return '';
  return String(p).replace(/[^0-9+]/g, '').replace(/^00/, '+');
}
function normalizeName(n) {
  return String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// ─── Part 1: Per-invoice parity ───
console.log('\n========== PART 1: POS invoice ↔ Shopify order customer parity ==========');

const issues = { noCustomerOnShopify: [], nameMismatch: [], phoneMismatch: [] };
for (const inv of invoices) {
  if (inv._id.startsWith('SHOPIFY-')) continue;
  if (inv.source && String(inv.source).includes('shopify')) continue;
  if (!inv.shopifyOrderId) continue;
  const order = shopifyOrderById.get(String(inv.shopifyOrderId));
  if (!order) continue;
  const posName = String(inv.customerName || '').trim();
  const posPhone = normalizePhone(inv.customerContact);
  const shopCust = order.customer;
  const shopName = shopCust ? `${shopCust.first_name || ''} ${shopCust.last_name || ''}`.trim() : '';
  const shopPhone = normalizePhone(shopCust?.phone);

  if (!shopCust) {
    issues.noCustomerOnShopify.push({ invoiceId: inv._id, posName, posPhone, shopifyOrderNumber: order.order_number, shopifyOrderId: String(order.id) });
    continue;
  }
  if (normalizeName(posName) !== normalizeName(shopName)) {
    issues.nameMismatch.push({ invoiceId: inv._id, posName, shopName, shopifyOrderNumber: order.order_number });
  }
  if (posPhone && shopPhone && posPhone !== shopPhone) {
    issues.phoneMismatch.push({ invoiceId: inv._id, posPhone, shopPhone, shopifyOrderNumber: order.order_number });
  }
}

console.log(`POS invoices with NO customer attached on Shopify:  ${issues.noCustomerOnShopify.length}`);
for (const i of issues.noCustomerOnShopify.slice(0, 20)) {
  console.log(`  ${i.invoiceId}  ${i.posName.padEnd(30)} phone=${i.posPhone || '-'}  → Shopify #${i.shopifyOrderNumber}`);
}
if (issues.noCustomerOnShopify.length > 20) console.log(`  ... ${issues.noCustomerOnShopify.length - 20} more`);

console.log(`\nName mismatches (linked customer but different name):  ${issues.nameMismatch.length}`);
for (const i of issues.nameMismatch.slice(0, 20)) {
  console.log(`  ${i.invoiceId}  POS="${i.posName}"  vs  Shopify="${i.shopName}"  (#${i.shopifyOrderNumber})`);
}

console.log(`\nPhone mismatches:  ${issues.phoneMismatch.length}`);
for (const i of issues.phoneMismatch.slice(0, 20)) {
  console.log(`  ${i.invoiceId}  POS=${i.posPhone}  vs  Shopify=${i.shopPhone}  (#${i.shopifyOrderNumber})`);
}

// ─── Part 2: weird name detector ───
console.log('\n========== PART 2: Weird POS customer names ==========');

const weird = {
  trailingWhitespace: [],
  multipleSpaces: [],
  allCapsParts: [],
  looksLikePhoneNumber: [],
  veryShort: [],
  containsNumbers: [],
  startsWithCustomerDash: [],
  blank: [],
  duplicateSuspects: [],
};

const PHONE_LIKE_RE = /^[\s+()\-0-9]{7,}$/;
const HAS_DIGIT_RE = /\d/;

for (const c of customers) {
  const raw = c.name == null ? '' : String(c.name);
  const trimmed = raw.trim();
  if (!trimmed) { weird.blank.push({ id: c._id, name: raw, phone: c.phone }); continue; }
  if (raw !== trimmed) weird.trailingWhitespace.push({ id: c._id, name: JSON.stringify(raw), phone: c.phone });
  if (/  +/.test(trimmed)) weird.multipleSpaces.push({ id: c._id, name: trimmed, phone: c.phone });
  // All-caps part: an entire word in ALL CAPS while another word isn't (subtle YELLING)
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && parts.some(p => p.length >= 3 && p === p.toUpperCase() && /[A-Z]/.test(p)) && parts.some(p => p !== p.toUpperCase())) {
    weird.allCapsParts.push({ id: c._id, name: trimmed, phone: c.phone });
  }
  if (PHONE_LIKE_RE.test(trimmed) && trimmed.replace(/\D/g, '').length >= 7) {
    weird.looksLikePhoneNumber.push({ id: c._id, name: trimmed, phone: c.phone });
  } else if (HAS_DIGIT_RE.test(trimmed)) {
    weird.containsNumbers.push({ id: c._id, name: trimmed, phone: c.phone });
  }
  if (trimmed.length < 3) weird.veryShort.push({ id: c._id, name: trimmed, phone: c.phone });
  if (/^customer\s*-\s*/i.test(trimmed)) weird.startsWithCustomerDash.push({ id: c._id, name: trimmed, phone: c.phone });
}

// Duplicate-suspects: two customers with the exact normalized name
const byNorm = new Map();
for (const c of customers) {
  const norm = normalizeName(c.name);
  if (!norm) continue;
  if (!byNorm.has(norm)) byNorm.set(norm, []);
  byNorm.get(norm).push(c);
}
for (const [norm, list] of byNorm) {
  if (list.length >= 2) {
    weird.duplicateSuspects.push({ normalized: norm, ids: list.map(c => ({ id: c._id, name: c.name, phone: c.phone })) });
  }
}

function dump(label, arr, fmt) {
  console.log(`\n${label}: ${arr.length}`);
  for (const x of arr.slice(0, 20)) console.log('  ' + fmt(x));
  if (arr.length > 20) console.log(`  ... ${arr.length - 20} more`);
}

dump('Trailing/leading whitespace', weird.trailingWhitespace,
  x => `${x.id}  ${x.name.padEnd(40)} phone=${x.phone || '-'}`);
dump('Multiple internal spaces', weird.multipleSpaces,
  x => `${x.id}  "${x.name}"  phone=${x.phone || '-'}`);
dump('Mixed/yelling caps (one word ALL CAPS)', weird.allCapsParts,
  x => `${x.id}  "${x.name}"  phone=${x.phone || '-'}`);
dump('Looks like a phone number (no name)', weird.looksLikePhoneNumber,
  x => `${x.id}  "${x.name}"  phone=${x.phone || '-'}`);
dump('Contains digits (likely garbage / phone embedded)', weird.containsNumbers,
  x => `${x.id}  "${x.name}"  phone=${x.phone || '-'}`);
dump('Very short (< 3 chars)', weird.veryShort,
  x => `${x.id}  "${x.name}"  phone=${x.phone || '-'}`);
dump('Starts with "Customer - " prefix', weird.startsWithCustomerDash,
  x => `${x.id}  "${x.name}"  phone=${x.phone || '-'}`);
dump('Blank name', weird.blank,
  x => `${x.id}  raw=${JSON.stringify(x.name)}  phone=${x.phone || '-'}`);

console.log(`\nDuplicate-suspects (same normalized name, multiple records):  ${weird.duplicateSuspects.length}`);
for (const d of weird.duplicateSuspects.slice(0, 15)) {
  console.log(`  "${d.normalized}":`);
  for (const c of d.ids) console.log(`    ${c.id}  "${c.name}"  phone=${c.phone || '-'}`);
}

const out = `scripts/audit-customers.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), parityIssues: issues, weird }, null, 2));
console.log(`\nFull report: ${out}`);
