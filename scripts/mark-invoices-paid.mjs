// Mark specific invoices as fully paid: add a payment == balanceDue,
// set amountPaid = grandTotal, balanceDue = 0, and remove linked hisaab
// outstanding-balance entries. Mirrors updateInvoicePayment in store.ts.
//
//   node scripts/mark-invoices-paid.mjs INV-000267 SHOPIFY-1370          # dry
//   node scripts/mark-invoices-paid.mjs INV-000267 SHOPIFY-1370 --apply

import { readFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const IDS = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!IDS.length) { console.error('Usage: node scripts/mark-invoices-paid.mjs <INV-ID...> [--apply]'); process.exit(1); }

const PROJECT_ID = 'hom-pos-52710474-ceeea';
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
function ext(doc) {
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
  const o = {}; for (const [k, v] of Object.entries(doc.fields || {})) o[k] = walk(v);
  o._id = doc.name.split('/').pop(); return o;
}
async function getDoc(coll, id) {
  const r = await fetch(`${BASE}/${coll}/${id}`, { headers: H });
  if (!r.ok) return null;
  return ext(await r.json());
}
async function listAll(coll) {
  const all = []; let pt = '';
  do {
    const d = await fetch(`${BASE}/${coll}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: H }).then(r => r.json());
    if (d.documents) all.push(...d.documents.map(ext));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}
async function patch(path, fields) {
  const params = new URLSearchParams();
  for (const f of Object.keys(fields)) params.append('updateMask.fieldPaths', f);
  const fsF = {}; for (const [k, v] of Object.entries(fields)) fsF[k] = toFs(v);
  const r = await fetch(`${BASE}/${path}?${params}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fsF }),
  });
  if (!r.ok) throw new Error(`patch ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
async function del(path) {
  const r = await fetch(`${BASE}/${path}`, { method: 'DELETE', headers: H });
  if (!r.ok && r.status !== 200) throw new Error(`delete ${path}: ${r.status}`);
}

const fmt = n => Number(n).toLocaleString('en-PK');
const now = new Date().toISOString();
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

const hisaab = await listAll('hisaab');

for (const id of IDS) {
  const inv = await getDoc('invoices', id);
  if (!inv) { console.log(`✗ ${id}: not found`); continue; }
  const grandTotal = Number(inv.grandTotal || 0);
  const bal = Number(inv.balanceDue || 0);
  if (bal <= 0.5) { console.log(`• ${id} (${inv.customerName}): already paid (balance ${fmt(bal)}) — skipping`); continue; }

  const history = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
  const newHistory = [...history, { amount: bal, date: now, notes: 'Payment received (marked paid)' }];
  const newPaid = newHistory.reduce((s, p) => s + Number(p.amount || 0), 0);
  const newBal = grandTotal - newPaid;
  const linkedDebits = hisaab.filter(h => h.linkedInvoiceId === id && Number(h.cashDebit || 0) > 0);

  console.log(`${id} (${inv.customerName})`);
  console.log(`  grandTotal=${fmt(grandTotal)}  paid ${fmt(inv.amountPaid || 0)} → ${fmt(newPaid)}  balance ${fmt(bal)} → ${fmt(newBal)}`);
  console.log(`  hisaab entries to remove: ${linkedDebits.length}${linkedDebits.length ? ' [' + linkedDebits.map(d => d._id).join(', ') + ']' : ''}`);

  if (!APPLY) { console.log(''); continue; }

  await patch(`invoices/${id}`, { paymentHistory: newHistory, amountPaid: newPaid, balanceDue: newBal });
  for (const d of linkedDebits) { await del(`hisaab/${d._id}`); }
  console.log(`  ✅ marked paid\n`);
}

if (!APPLY) console.log('DRY RUN — re-run with --apply to write.');
