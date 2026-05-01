// Find and fix duplicate payment entries in POS invoices.
// Definition of "duplicate": consecutive paymentHistory entries with the same
// amount, same calendar day, and same notes (or both notes empty).
//
// Recalculates amountPaid and balanceDue. Also updates linked hisaab entries
// (the cashDebit "Outstanding balance for Invoice X" rows).
//
// Usage:
//   node scripts/dedupe-invoice-payments.mjs              # dry run
//   node scripts/dedupe-invoice-payments.mjs --apply

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'hom-pos-52710474-ceeea';

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
async function patchInvoice(id, fields, replaceMode = false) {
  // For payment history dedup we need to REPLACE the array, so we use updateMask
  // listing every field we want to change.
  const params = new URLSearchParams();
  for (const f of Object.keys(fields)) params.append('updateMask.fieldPaths', f);
  const url = `${FB_BASE}/invoices/${id}?${params.toString()}`;
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) fsFields[k] = toFsValue(v);
  const r = await fetch(url, {
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
const hisaabByInvoice = new Map();
for (const h of hisaab) {
  if (h.linkedInvoiceId) {
    if (!hisaabByInvoice.has(h.linkedInvoiceId)) hisaabByInvoice.set(h.linkedInvoiceId, []);
    hisaabByInvoice.get(h.linkedInvoiceId).push(h);
  }
}

function dayOf(iso) { return String(iso || '').slice(0, 10); }

function dedupePayments(history) {
  if (!Array.isArray(history) || history.length <= 1) return { dedupedHistory: history || [], removed: [] };
  const out = [];
  const removed = [];
  let prev = null;
  for (const p of history) {
    const fp = `${Number(p.amount)}|${dayOf(p.date)}|${p.notes || ''}`;
    if (prev && fp === prev) { removed.push(p); continue; }
    out.push(p);
    prev = fp;
  }
  return { dedupedHistory: out, removed };
}

const fixes = [];
for (const inv of invoices) {
  if (!Array.isArray(inv.paymentHistory)) continue;
  const { dedupedHistory, removed } = dedupePayments(inv.paymentHistory);
  if (!removed.length) continue;
  const oldPaid = Number(inv.amountPaid || 0);
  const newPaid = dedupedHistory.reduce((s, p) => s + Number(p.amount || 0), 0);
  const oldBalance = Number(inv.balanceDue || 0);
  const grandTotal = Number(inv.grandTotal || 0);
  const newBalance = grandTotal - newPaid;
  fixes.push({
    invoiceId: inv._id,
    customer: inv.customerName,
    grandTotal,
    oldPaid, newPaid, paidDelta: oldPaid - newPaid,
    oldBalance, newBalance,
    removedCount: removed.length,
    keptCount: dedupedHistory.length,
    dedupedHistory,
    removedSamples: removed.slice(0, 3).map(r => ({ amount: r.amount, date: r.date, notes: r.notes })),
  });
}

console.log(`\nInvoices with duplicate payment entries: ${fixes.length}\n`);
for (const f of fixes) {
  console.log(`${f.invoiceId}  ${(f.customer || '').padEnd(28)} grandTotal=${f.grandTotal}  paid: ${f.oldPaid} → ${f.newPaid} (-${f.paidDelta})  balance: ${f.oldBalance} → ${f.newBalance}  removed=${f.removedCount}, kept=${f.keptCount}`);
}

if (!APPLY) {
  console.log('\nDRY RUN. Re-run with --apply to fix.');
  process.exit(0);
}

console.log('\n=== APPLYING ===');
const results = { patched: [], hisaabAdjusted: [], errors: [] };
for (const f of fixes) {
  try {
    await patchInvoice(f.invoiceId, {
      paymentHistory: f.dedupedHistory,
      amountPaid: f.newPaid,
      balanceDue: f.newBalance,
    });
    results.patched.push(f.invoiceId);

    // Reconcile linked hisaab debit entries.
    const linked = hisaabByInvoice.get(f.invoiceId) || [];
    const debits = linked.filter(h => Number(h.cashDebit || 0) > 0);
    if (f.newBalance <= 0) {
      // Fully covered (or overpaid) — drop debit entries
      for (const d of debits) { await deleteHisaab(d._id); results.hisaabAdjusted.push({ id: d._id, action: 'deleted' }); }
    } else if (debits.length > 0) {
      // Update first to new balance, delete rest
      await patchHisaab(debits[0]._id, { cashDebit: f.newBalance });
      results.hisaabAdjusted.push({ id: debits[0]._id, action: 'updated', cashDebit: f.newBalance });
      for (const d of debits.slice(1)) { await deleteHisaab(d._id); results.hisaabAdjusted.push({ id: d._id, action: 'deleted' }); }
    }
    console.log(`  ${f.invoiceId}: paymentHistory ${f.oldPaid} → ${f.newPaid}, hisaab adjusted`);
  } catch (e) {
    console.log(`  ${f.invoiceId}: ERROR ${e.message}`);
    results.errors.push({ invoiceId: f.invoiceId, error: e.message });
  }
}

console.log(`\n=== DONE ===`);
console.log(`Invoices patched: ${results.patched.length}`);
console.log(`Hisaab entries adjusted: ${results.hisaabAdjusted.length}`);
console.log(`Errors: ${results.errors.length}`);
const out = `scripts/dedupe-invoice-payments.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), fixes, results }, null, 2));
console.log(`Log: ${out}`);
