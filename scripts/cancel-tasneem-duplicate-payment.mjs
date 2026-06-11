// Find Tasneem Lotia's most recent invoice with payment history,
// show the payments, identify the duplicate, and remove it.
//
// Usage:
//   node scripts/cancel-tasneem-duplicate-payment.mjs              # dry run
//   node scripts/cancel-tasneem-duplicate-payment.mjs --apply

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
    method: 'PATCH',
    headers: { ...fbHeaders, 'Content-Type': 'application/json' },
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
    method: 'PATCH',
    headers: { ...fbHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fsFields }),
  });
  if (!r.ok) throw new Error(`hisaab patch ${id}: ${r.status}`);
}
async function deleteHisaab(id) {
  await fetch(`${FB_BASE}/hisaab/${id}`, { method: 'DELETE', headers: fbHeaders });
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\nLoading invoices + hisaab...`);

const [invoices, hisaab] = await Promise.all([listAll('invoices'), listAll('hisaab')]);

// Find Tasneem Lotia invoices
const tasneemInvs = invoices
  .filter(i => /tasneem.*lotia|lotia.*tasneem/i.test(i.customerName || ''))
  .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

if (tasneemInvs.length === 0) {
  console.log('No Tasneem Lotia invoices found.');
  process.exit(0);
}

console.log(`\nFound ${tasneemInvs.length} Tasneem Lotia invoice(s):\n`);
for (const inv of tasneemInvs.slice(0, 10)) {
  const ph = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
  console.log(`${inv._id}  customer=${inv.customerName}  grandTotal=${inv.grandTotal}  amountPaid=${inv.amountPaid}  balanceDue=${inv.balanceDue}  payments=${ph.length}  createdAt=${inv.createdAt}`);
  ph.forEach((p, i) => {
    console.log(`    [${i}] amount=${p.amount}  date=${p.date}  method=${p.method || '?'}  notes=${p.notes || ''}`);
  });
  console.log('');
}

// Pick the invoice with a recent duplicate payment.
// A "duplicate" here = two paymentHistory entries with the same amount on the same day.
let target = null;
let dupIdx = -1;
for (const inv of tasneemInvs) {
  const ph = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
  if (ph.length < 2) continue;
  // Find the latest pair of duplicates (same amount + same day).
  for (let i = ph.length - 1; i > 0; i--) {
    for (let j = i - 1; j >= 0; j--) {
      const a = ph[i], b = ph[j];
      const sameDay = String(a.date || '').slice(0, 10) === String(b.date || '').slice(0, 10);
      const sameAmt = Number(a.amount) === Number(b.amount);
      if (sameDay && sameAmt) {
        target = inv;
        dupIdx = i;  // remove the later one
        break;
      }
    }
    if (target) break;
  }
  if (target) break;
}

if (!target) {
  console.log('\nNo duplicate payment found by exact (amount, day) match.');
  console.log('Inspect the output above and re-run with the right invoice ID hard-coded.');
  process.exit(0);
}

const oldHistory = target.paymentHistory;
const dupPayment = oldHistory[dupIdx];
const newHistory = oldHistory.filter((_, i) => i !== dupIdx);
const newPaid = newHistory.reduce((s, p) => s + Number(p.amount || 0), 0);
const grandTotal = Number(target.grandTotal || 0);
const newBalance = grandTotal - newPaid;

console.log(`\n=== TARGET: ${target._id} (${target.customerName}) ===`);
console.log(`Removing duplicate payment at index ${dupIdx}: amount=${dupPayment.amount}  date=${dupPayment.date}  method=${dupPayment.method || '?'}`);
console.log(`Payments: ${oldHistory.length} -> ${newHistory.length}`);
console.log(`amountPaid: ${target.amountPaid} -> ${newPaid}`);
console.log(`balanceDue: ${target.balanceDue} -> ${newBalance}`);

if (!APPLY) {
  console.log('\nDRY RUN. Re-run with --apply to fix.');
  process.exit(0);
}

console.log('\n=== APPLYING ===');
await patchInvoice(target._id, {
  paymentHistory: newHistory,
  amountPaid: newPaid,
  balanceDue: newBalance,
});
console.log(`Invoice ${target._id} patched.`);

// Adjust linked hisaab cashDebit entries
const linked = hisaab.filter(h => h.linkedInvoiceId === target._id);
const debits = linked.filter(h => Number(h.cashDebit || 0) > 0);
if (newBalance <= 0) {
  for (const d of debits) { await deleteHisaab(d._id); console.log(`  hisaab ${d._id} deleted`); }
} else if (debits.length > 0) {
  await patchHisaab(debits[0]._id, { cashDebit: newBalance });
  console.log(`  hisaab ${debits[0]._id} cashDebit -> ${newBalance}`);
  for (const d of debits.slice(1)) { await deleteHisaab(d._id); console.log(`  hisaab ${d._id} deleted`); }
}

const log = `scripts/cancel-tasneem-duplicate-payment.${Date.now()}.json`;
writeFileSync(log, JSON.stringify({
  ranAt: new Date().toISOString(),
  invoiceId: target._id,
  customer: target.customerName,
  removedPayment: dupPayment,
  oldPaid: target.amountPaid,
  newPaid,
  oldBalance: target.balanceDue,
  newBalance,
  oldHistory,
  newHistory,
}, null, 2));
console.log(`\nLog: ${log}`);
