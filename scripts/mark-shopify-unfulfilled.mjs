// Set shopifyFulfillment on specific Shopify invoices so the Workshop picks
// them up.
//
// buildWorkshopJobs treats an online sale as bench work when source starts
// with "shopify" AND either shopifyFulfillment is present and not "fulfilled",
// or — the legacy path — the note text matches /unfulfilled/. Orders imported
// through the app write "Status: {financial_status}", which for a pending
// order reads "Status: pending" and matches neither, so the pieces never
// reached the bench.
//
// The value written is read from Shopify, never assumed.
//
//   node scripts/mark-shopify-unfulfilled.mjs SHOPIFY-1398 SHOPIFY-1399
//   node scripts/mark-shopify-unfulfilled.mjs --apply SHOPIFY-1398 SHOPIFY-1399

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import dotenv from 'dotenv';
// The credentials live in .env.local, which dotenv/config does not read.
dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const IDS = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!IDS.length) { console.error('give at least one invoice id'); process.exit(1); }

const PROJECT_ID = process.env.FB_PROJECT || 'hom-pos-52710474-ceeea';
const fb = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const tk = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: fb.tokens.refresh_token,
    client_id: fb.tokens.client_id || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: fb.tokens.client_secret || 'j9iVZfS8kkCEFUPaAeJV0sAi' }),
});
const { access_token } = await tk.json();
const FB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const auth = { Authorization: `Bearer ${access_token}` };

const shop = process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
const stok = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN;
if (!shop || !stok) { console.error('Shopify credentials missing from .env.local'); process.exit(1); }

const plan = [];
for (const id of IDS) {
  const res = await fetch(`${FB}/invoices/${encodeURIComponent(id)}`, { headers: auth });
  if (!res.ok) { console.log(`  ${id}: not found (${res.status})`); continue; }
  const doc = await res.json();
  const f = doc.fields || {};
  const num = id.replace(/^SHOPIFY-/, '');

  // Ask Shopify what the fulfilment actually is.
  const sr = await fetch(`https://${shop}/admin/api/2026-01/orders.json?status=any&name=%23${num}&fields=order_number,fulfillment_status`,
    { headers: { 'X-Shopify-Access-Token': stok } });
  const sj = await sr.json();
  const order = (sj.orders || []).find(o => String(o.order_number) === num);
  if (!order) { console.log(`  ${id}: no matching Shopify order #${num}`); continue; }

  const value = order.fulfillment_status === null ? 'unfulfilled' : String(order.fulfillment_status);
  const items = (f.items?.arrayValue?.values || []).length;
  plan.push({
    id,
    before: f.shopifyFulfillment?.stringValue ?? null,
    after: value,
    items,
    notes: f.notes?.stringValue || '',
  });
}

console.log(`\n${plan.length} invoice(s):\n`);
for (const p of plan) {
  console.log(`  ${p.id.padEnd(14)} items=${p.items}  shopifyFulfillment: ${JSON.stringify(p.before)} → ${JSON.stringify(p.after)}`);
  console.log(`      reaches the bench after this: ${p.after !== 'fulfilled'}`);
}

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }

mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `backups/shopify-fulfilment-${stamp}.json`;
writeFileSync(backup, JSON.stringify({ project: PROJECT_ID, takenAt: new Date().toISOString(), plan }, null, 2));
console.log(`\nbackup of prior values → ${backup}`);

let ok = 0;
for (const p of plan) {
  // Field mask: this one field is the whole write.
  const res = await fetch(`${FB}/invoices/${encodeURIComponent(p.id)}?updateMask.fieldPaths=shopifyFulfillment`, {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { shopifyFulfillment: { stringValue: p.after } } }),
  });
  if (res.ok) ok++; else console.log(`  FAILED ${p.id}: ${res.status} ${(await res.text()).slice(0, 140)}`);
}
console.log(`\n${ok} written, ${plan.length - ok} failed`);
