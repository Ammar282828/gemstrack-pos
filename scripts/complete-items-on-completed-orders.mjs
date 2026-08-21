// Tick isCompleted on every item of orders already marked Completed.
//
// Orders get marked Completed as a whole; the per-item checkboxes are rarely
// ticked one by one, which left finished pieces showing as pending work on the
// Workshop dashboard. New completions handle this in the store — this backfills
// the history.
//
//   node scripts/complete-items-on-completed-orders.mjs                    # dry (Mina)
//   node scripts/complete-items-on-completed-orders.mjs --apply
//   node scripts/complete-items-on-completed-orders.mjs --project gemstrack-pos --apply   # Taheri

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const pi = args.indexOf('--project');
const PROJECT_ID = pi >= 0 ? args[pi + 1] : 'hom-pos-52710474-ceeea';
const STORE = PROJECT_ID === 'gemstrack-pos' ? 'Taheri' : PROJECT_ID.startsWith('hom-pos') ? 'MINA' : PROJECT_ID;

const _fetch = globalThis.fetch;
async function fetch(url, opts) {
  let last;
  for (let i = 1; i <= 6; i++) {
    try { return await _fetch(url, opts); } catch (e) { last = e; await new Promise(r => setTimeout(r, 700 * i)); }
  }
  throw last;
}

const fb = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: fb.tokens.refresh_token,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  }),
}).then(r => r.json());
const H = { Authorization: `Bearer ${tok.access_token}` };
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; for (const [k, vv] of Object.entries(v)) f[k] = toFs(vv); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
const walk = v => {
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
const ext = d => { const o = {}; for (const [k, v] of Object.entries(d.fields || {})) o[k] = walk(v); o._id = d.name.split('/').pop(); return o; };

async function listAll(coll) {
  const all = []; let pt = '';
  do {
    const d = await fetch(`${BASE}/${coll}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: H }).then(r => r.json());
    if (d.documents) all.push(...d.documents.map(ext));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}
async function patchItems(orderId, items) {
  const params = new URLSearchParams(); params.append('updateMask.fieldPaths', 'items');
  const r = await fetch(`${BASE}/orders/${orderId}?${params}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { items: toFs(items) } }),
  });
  if (!r.ok) throw new Error(`patch ${orderId}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}   →  ${STORE} (${PROJECT_ID})\n`);

const orders = await listAll('orders');
const targets = [];
for (const o of orders) {
  if (o.status !== 'Completed') continue;
  const items = Array.isArray(o.items) ? o.items : [];
  const untickedCount = items.filter(i => i && i.isCompleted !== true).length;
  if (!untickedCount) continue;
  targets.push({ id: o._id, customer: o.customerName || 'Walk-in', createdAt: o.createdAt, items, untickedCount });
}

const totalItems = targets.reduce((s, t) => s + t.untickedCount, 0);
console.log(`Completed orders with unticked items: ${targets.length}  (${totalItems} items)\n`);
targets
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  .forEach(t => {
    const age = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000);
    console.log(`  ${t.id.padEnd(13)} ${String(t.customer).slice(0, 22).padEnd(24)} ${String(t.untickedCount).padStart(2)} item(s)  ${age}d old`);
  });

if (!targets.length) { console.log('\nNothing to fix.'); process.exit(0); }
if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }

console.log('\n=== APPLYING ===');
const log = [];
for (const t of targets) {
  const updated = t.items.map(i => ({ ...i, isCompleted: true }));
  await patchItems(t.id, updated);
  log.push({ orderId: t.id, itemsTicked: t.untickedCount, before: t.items });
  console.log(`  ${t.id}: ${t.untickedCount} item(s) marked complete`);
}
const out = `scripts/complete-items-on-completed-orders.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), project: PROJECT_ID, log }, null, 2));
console.log(`\nDone. ${targets.length} orders, ${totalItems} items.\nBackup of prior item state: ${out}`);
