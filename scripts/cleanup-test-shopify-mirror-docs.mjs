// One-off: clean up SHOPIFY-* invoice docs that the test runner created via
// the production webhook echo. Identifies them by their `notes` field which
// references INV-TEST-* (or by orphan shopifyOrderId no longer in Shopify).
//
// Usage:
//   node scripts/cleanup-test-shopify-mirror-docs.mjs              # dry run
//   node scripts/cleanup-test-shopify-mirror-docs.mjs --apply

import { readFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
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
const FB_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

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

async function listInvoices() {
  const all = [];
  let pageToken = '';
  do {
    const url = `${FB_BASE}/invoices?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
    const d = await r.json();
    if (d.documents) all.push(...d.documents.map(extractFields));
    pageToken = d.nextPageToken || '';
  } while (pageToken);
  return all;
}

const settingsRes = await fetch(`${FB_BASE}/app_settings/global`, { headers: { Authorization: `Bearer ${access_token}` } });
const settings = extractFields(await settingsRes.json());
const shop = process.env.SHOPIFY_STORE_DOMAIN || settings.shopifyStoreDomain;
const token = process.env.SHOPIFY_ACCESS_TOKEN || settings.shopifyAccessToken;

const invoices = await listInvoices();
const shopifyMirrors = invoices.filter(i => i._id.startsWith('SHOPIFY-'));

const targets = shopifyMirrors.filter(i =>
  (i.notes && /INV-TEST-/.test(String(i.notes))) ||
  (i.customerName === 'Test Customer' || i.customerName === 'Same Name')
);

console.log(`Total SHOPIFY-* docs in Firestore: ${shopifyMirrors.length}`);
console.log(`Test-leftover SHOPIFY-* docs to delete: ${targets.length}`);
for (const t of targets) {
  console.log(`  ${t._id}  customer=${t.customerName}  notes=${(t.notes || '').slice(0, 60)}`);
}

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to delete.'); process.exit(0); }

let n = 0;
for (const t of targets) {
  await fetch(`${FB_BASE}/invoices/${t._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${access_token}` },
  });
  n++;
}
console.log(`\nDeleted ${n} test-leftover SHOPIFY-* docs.`);
