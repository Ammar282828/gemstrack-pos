// INV-000236 (Tasneem Huzaifa) has 4 paymentHistory entries:
//   [0] 10,000 advance (legit)
//   [1] 12,000 payment (legit)
//   [2] 12,000 duplicate
//   [3] 12,000 duplicate
// And 5 activity_log invoice.payment rows for the same 12,000 amount.
//
// Collapse to: [0] 10,000 advance + earliest 12,000 = 2 entries.
// Keep earliest matching activity_log entry, delete the other 4.
//
// Usage:
//   node scripts/collapse-tasneem-huzaifa-payments.mjs          # dry
//   node scripts/collapse-tasneem-huzaifa-payments.mjs --apply

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const TARGET_ID = 'INV-000236';
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
async function getDoc(path) {
  const r = await fetch(`${FB}/${path}`, { headers: H });
  if (!r.ok) throw new Error(`get ${path}: ${r.status}`);
  return extractFields(await r.json());
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
async function del(path) {
  const r = await fetch(`${FB}/${path}`, { method: 'DELETE', headers: H });
  if (!r.ok && r.status !== 200) throw new Error(`delete ${path}: ${r.status}`);
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

const inv = await getDoc(`invoices/${TARGET_ID}`);
const ph = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
console.log(`\n${TARGET_ID} (${inv.customerName}) total=${inv.grandTotal} paid=${inv.amountPaid} bal=${inv.balanceDue}`);
ph.forEach((p, i) => console.log(`  [${i}] amount=${p.amount}  date=${p.date}  notes=${p.notes || ''}`));

// Collapse paymentHistory: for each (amount, day) group, keep the earliest
// (by date) entry only. Preserve original chronological order in output.
const dayOf = (iso) => String(iso || '').slice(0, 10);
const sortedByDate = ph.map((p, i) => ({ p, i })).sort((a, b) => String(a.p.date).localeCompare(String(b.p.date)));
const keptIdx = new Set();
const seenKey = new Set();
for (const { p, i } of sortedByDate) {
  const key = `${Number(p.amount)}|${dayOf(p.date)}`;
  if (seenKey.has(key)) continue;
  seenKey.add(key);
  keptIdx.add(i);
}
const newHistory = ph.filter((_, i) => keptIdx.has(i));
const newPaid = newHistory.reduce((s, p) => s + Number(p.amount || 0), 0);
const grandTotal = Number(inv.grandTotal || 0);
const newBalance = grandTotal - newPaid;

console.log(`\nAfter collapse:`);
console.log(`  payments: ${ph.length} -> ${newHistory.length}`);
console.log(`  amountPaid: ${inv.amountPaid} -> ${newPaid}`);
console.log(`  balanceDue: ${inv.balanceDue} -> ${newBalance}`);
newHistory.forEach((p, i) => console.log(`    [${i}] amount=${p.amount}  date=${p.date}`));

// Activity log: for each (amount, day) in newHistory, keep earliest matching
// invoice.payment log; delete the rest for the same invoice.
const logs = await listAll('activity_log');
const logsForInv = logs
  .filter(l => l.eventType === 'invoice.payment' && l.entityId === TARGET_ID)
  .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
console.log(`\nactivity_log invoice.payment for ${TARGET_ID}: ${logsForInv.length}`);
for (const m of logsForInv) console.log(`  ${m._id}  ts=${m.timestamp}  ${m.details}`);

// Build "expected count" per (amount, day)
const expected = new Map();
for (const p of newHistory) {
  const k = `${Number(p.amount)}|${dayOf(p.date)}`;
  expected.set(k, (expected.get(k) || 0) + 1);
}

// Walk logs in time order; keep up to `expected[key]` of each (amount, day).
// Match log to (amount, day) by parsing details + log timestamp's day.
const logsToDelete = [];
const counts = new Map();
for (const m of logsForInv) {
  const amtMatch = String(m.details || '').match(/Amount:\s*([\d,]+)/);
  const amt = amtMatch ? Number(amtMatch[1].replace(/,/g, '')) : null;
  const day = dayOf(m.timestamp);
  const k = `${amt}|${day}`;
  const allowed = expected.get(k) || 0;
  const used = counts.get(k) || 0;
  if (used >= allowed) { logsToDelete.push(m); continue; }
  counts.set(k, used + 1);
}

console.log(`\nLogs to delete: ${logsToDelete.length}`);
for (const m of logsToDelete) console.log(`  ${m._id}  ${m.timestamp}  ${m.details}`);

// hisaab adjustment
const hisaab = await listAll('hisaab');
const linked = hisaab.filter(h => h.linkedInvoiceId === TARGET_ID);
const debits = linked.filter(h => Number(h.cashDebit || 0) > 0);
console.log(`\nLinked hisaab debit rows: ${debits.length}`);
debits.forEach(d => console.log(`  ${d._id}  cashDebit=${d.cashDebit}`));

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply.'); process.exit(0); }

console.log('\n=== APPLYING ===');
await patch(`invoices/${TARGET_ID}`, {
  paymentHistory: newHistory,
  amountPaid: newPaid,
  balanceDue: newBalance,
});
console.log(`invoice patched.`);

if (newBalance <= 0) {
  for (const d of debits) { await del(`hisaab/${d._id}`); console.log(`  hisaab ${d._id} deleted`); }
} else if (debits.length > 0) {
  await patch(`hisaab/${debits[0]._id}`, { cashDebit: newBalance });
  console.log(`  hisaab ${debits[0]._id} cashDebit -> ${newBalance}`);
  for (const d of debits.slice(1)) { await del(`hisaab/${d._id}`); console.log(`  hisaab ${d._id} deleted`); }
}

for (const m of logsToDelete) { await del(`activity_log/${m._id}`); console.log(`  activity_log ${m._id} deleted`); }

const out = `scripts/collapse-tasneem-huzaifa-payments.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({
  ranAt: new Date().toISOString(),
  invoice: { id: TARGET_ID, oldPaid: inv.amountPaid, newPaid, oldBalance: inv.balanceDue, newBalance, oldHistory: ph, newHistory },
  deletedActivityLogs: logsToDelete.map(m => ({ id: m._id, ts: m.timestamp, details: m.details })),
}, null, 2));
console.log(`\nLog: ${out}`);
