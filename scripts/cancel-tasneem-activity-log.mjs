// Delete the duplicate 'invoice.payment' activity_log entry for
// Tasneem Lotia (INV-000234). The duplicate was the second PKR 20,000
// payment, logged ~80 seconds after the first on 2026-05-22.
//
// Usage:
//   node scripts/cancel-tasneem-activity-log.mjs            # dry run
//   node scripts/cancel-tasneem-activity-log.mjs --apply

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'hom-pos-52710474-ceeea';

const fbConfig = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: fbConfig.tokens.refresh_token,
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
    const r = await fetch(`${FB_BASE}/${name}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`, { headers: fbHeaders });
    const d = await r.json();
    if (d.documents) all.push(...d.documents.map(extractFields));
    pageToken = d.nextPageToken || '';
  } while (pageToken);
  return all;
}
async function deleteDoc(name, id) {
  const r = await fetch(`${FB_BASE}/${name}/${id}`, { method: 'DELETE', headers: fbHeaders });
  if (!r.ok && r.status !== 200) throw new Error(`delete ${name}/${id}: ${r.status} ${(await r.text()).slice(0,200)}`);
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\nLoading activity_log...`);

const logs = await listAll('activity_log');

// Find invoice.payment entries for INV-000234.
const matches = logs
  .filter(l => l.eventType === 'invoice.payment' && l.entityId === 'INV-000234')
  .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

console.log(`\nFound ${matches.length} 'invoice.payment' log entries for INV-000234:`);
for (const m of matches) {
  console.log(`  ${m._id}  ts=${m.timestamp}  desc=${m.description}  details=${m.details}`);
}

// Also any "Advance from Order" payment-style entry on the order?
// The first paymentHistory row [0] was an order advance — it would have been
// logged under order.update or invoice.create, NOT invoice.payment. So we
// only need to dedupe the invoice.payment rows (there should be 2 for INV-000234,
// remove the later one).
if (matches.length < 2) {
  console.log('\nNothing to dedupe — fewer than 2 matching entries.');
  process.exit(0);
}

// Keep the earliest, drop the rest (in case there's >2 somehow).
const toDelete = matches.slice(1);
console.log(`\nWill delete ${toDelete.length} duplicate(s):`);
for (const d of toDelete) console.log(`  ${d._id}  ts=${d.timestamp}`);

if (!APPLY) {
  console.log('\nDRY RUN. Re-run with --apply.');
  process.exit(0);
}

console.log('\n=== APPLYING ===');
for (const d of toDelete) {
  await deleteDoc('activity_log', d._id);
  console.log(`  deleted ${d._id}`);
}

const log = `scripts/cancel-tasneem-activity-log.${Date.now()}.json`;
writeFileSync(log, JSON.stringify({ ranAt: new Date().toISOString(), kept: matches[0], deleted: toDelete }, null, 2));
console.log(`\nLog: ${log}`);
