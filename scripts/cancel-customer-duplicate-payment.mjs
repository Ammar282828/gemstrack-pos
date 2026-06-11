// Find a customer's most recent invoice, identify a duplicate payment
// (same amount, same day), and remove it from:
//   1. invoices/<id>.paymentHistory  (recalc amountPaid + balanceDue)
//   2. linked hisaab cashDebit row    (adjust to new balance, or delete)
//   3. activity_log invoice.payment   (delete the later duplicate)
//
// Usage:
//   node scripts/cancel-customer-duplicate-payment.mjs "Malaika Jamal"
//   node scripts/cancel-customer-duplicate-payment.mjs "Malaika Jamal" --apply

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const customerQuery = args.filter(a => a !== '--apply')[0];
if (!customerQuery) {
  console.error('Usage: node scripts/cancel-customer-duplicate-payment.mjs "<customer name>" [--apply]');
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
async function patchInvoice(id, fields) {
  const params = new URLSearchParams();
  for (const f of Object.keys(fields)) params.append('updateMask.fieldPaths', f);
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) fsFields[k] = toFsValue(v);
  const r = await fetch(`${FB_BASE}/invoices/${id}?${params.toString()}`, {
    method: 'PATCH', headers: { ...fbHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fsFields }),
  });
  if (!r.ok) throw new Error(`patch ${id}: ${r.status} ${(await r.text()).slice(0,200)}`);
}
async function patchHisaab(id, fields) {
  const params = new URLSearchParams();
  for (const f of Object.keys(fields)) params.append('updateMask.fieldPaths', f);
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) fsFields[k] = toFsValue(v);
  const r = await fetch(`${FB_BASE}/hisaab/${id}?${params.toString()}`, {
    method: 'PATCH', headers: { ...fbHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fsFields }),
  });
  if (!r.ok) throw new Error(`hisaab patch ${id}: ${r.status}`);
}
async function deleteDoc(name, id) {
  const r = await fetch(`${FB_BASE}/${name}/${id}`, { method: 'DELETE', headers: fbHeaders });
  if (!r.ok && r.status !== 200) throw new Error(`delete ${name}/${id}: ${r.status}`);
}

const re = new RegExp(customerQuery.split(/\s+/).join('.*'), 'i');
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\nLooking for invoices matching /${re.source}/i ...`);

const [invoices, hisaab, logs] = await Promise.all([
  listAll('invoices'),
  listAll('hisaab'),
  listAll('activity_log'),
]);

const matched = invoices
  .filter(i => re.test(i.customerName || ''))
  .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

if (matched.length === 0) { console.log('No matching invoices.'); process.exit(0); }

console.log(`\nFound ${matched.length} matching invoice(s):`);
for (const inv of matched.slice(0, 10)) {
  const ph = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
  console.log(`  ${inv._id}  ${inv.customerName}  total=${inv.grandTotal}  paid=${inv.amountPaid}  bal=${inv.balanceDue}  payments=${ph.length}  createdAt=${inv.createdAt}`);
  ph.forEach((p, i) => console.log(`    [${i}] amount=${p.amount}  date=${p.date}  notes=${p.notes || ''}`));
}

// Find the latest invoice with a same-amount-same-day duplicate.
let target = null;
let dupIdx = -1;
for (const inv of matched) {
  const ph = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
  if (ph.length < 2) continue;
  for (let i = ph.length - 1; i > 0 && !target; i--) {
    for (let j = i - 1; j >= 0; j--) {
      const a = ph[i], b = ph[j];
      const sameDay = String(a.date || '').slice(0, 10) === String(b.date || '').slice(0, 10);
      const sameAmt = Number(a.amount) === Number(b.amount);
      if (sameDay && sameAmt) { target = inv; dupIdx = i; break; }
    }
  }
  if (target) break;
}
if (!target) { console.log('\nNo same-amount-same-day duplicate found.'); process.exit(0); }

const oldHistory = target.paymentHistory;
const dupPayment = oldHistory[dupIdx];
const newHistory = oldHistory.filter((_, i) => i !== dupIdx);
const newPaid = newHistory.reduce((s, p) => s + Number(p.amount || 0), 0);
const grandTotal = Number(target.grandTotal || 0);
const newBalance = grandTotal - newPaid;

console.log(`\n=== TARGET INVOICE: ${target._id} (${target.customerName}) ===`);
console.log(`Removing payment[${dupIdx}]: amount=${dupPayment.amount}  date=${dupPayment.date}`);
console.log(`Payments: ${oldHistory.length} -> ${newHistory.length}`);
console.log(`amountPaid: ${target.amountPaid} -> ${newPaid}`);
console.log(`balanceDue: ${target.balanceDue} -> ${newBalance}`);

// Matching activity_log invoice.payment entries
const logMatches = logs
  .filter(l => l.eventType === 'invoice.payment' && l.entityId === target._id)
  .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
console.log(`\nactivity_log invoice.payment entries for ${target._id}: ${logMatches.length}`);
for (const m of logMatches) console.log(`  ${m._id}  ts=${m.timestamp}  details=${m.details}`);

// Build a deletion plan for logs.
// Goal: after fixing, # of invoice.payment log entries for each (amount, day)
// should equal the number of paymentHistory rows with that (amount, day) in
// the corrected newHistory. Keep the earliest N, delete the rest.
const dayOf = (iso) => String(iso || '').slice(0, 10);
const dupDay = dayOf(dupPayment.date);
const amtNeedle = Number(dupPayment.amount).toLocaleString();

// How many legit payments remain at this (amount, day)?
const keepCount = newHistory.filter(p =>
  Number(p.amount) === Number(dupPayment.amount) && dayOf(p.date) === dupDay
).length;

// Matching log entries for this invoice + amount + day.
const sameAmtDayLogs = logMatches.filter(m =>
  String(m.details || '').includes(`Amount: ${amtNeedle}`) &&
  dayOf(m.timestamp) === dupDay
);
const logsToDelete = sameAmtDayLogs.slice(keepCount); // keep earliest keepCount

console.log(`\nactivity_log entries to delete: ${logsToDelete.length}`);
for (const m of logsToDelete) console.log(`  ${m._id}  ts=${m.timestamp}`);

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply.'); process.exit(0); }

console.log('\n=== APPLYING ===');
await patchInvoice(target._id, { paymentHistory: newHistory, amountPaid: newPaid, balanceDue: newBalance });
console.log(`Invoice ${target._id} patched.`);

const linked = hisaab.filter(h => h.linkedInvoiceId === target._id);
const debits = linked.filter(h => Number(h.cashDebit || 0) > 0);
if (newBalance <= 0) {
  for (const d of debits) { await deleteDoc('hisaab', d._id); console.log(`  hisaab ${d._id} deleted`); }
} else if (debits.length > 0) {
  await patchHisaab(debits[0]._id, { cashDebit: newBalance });
  console.log(`  hisaab ${debits[0]._id} cashDebit -> ${newBalance}`);
  for (const d of debits.slice(1)) { await deleteDoc('hisaab', d._id); console.log(`  hisaab ${d._id} deleted`); }
}

for (const m of logsToDelete) { await deleteDoc('activity_log', m._id); console.log(`  activity_log ${m._id} deleted`); }

const out = `scripts/cancel-customer-duplicate-payment.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({
  ranAt: new Date().toISOString(),
  query: customerQuery,
  invoiceId: target._id,
  customer: target.customerName,
  removedPayment: dupPayment,
  oldPaid: target.amountPaid, newPaid,
  oldBalance: target.balanceDue, newBalance,
  oldHistory, newHistory,
  deletedActivityLogs: logsToDelete.map(m => ({ id: m._id, ts: m.timestamp, details: m.details })),
}, null, 2));
console.log(`\nLog: ${out}`);
