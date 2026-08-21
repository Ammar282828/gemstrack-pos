// Collapse duplicated payments on one or more invoices.
//
// Keeps the earliest payment of each (amount, calendar day) group, recomputes
// amountPaid / balanceDue, reconciles the linked hisaab row, and removes the
// now-orphaned duplicate activity-log lines.
//
//   node scripts/collapse-duplicate-payments.mjs INV-000246 INV-000257
//   node scripts/collapse-duplicate-payments.mjs INV-000246 INV-000257 --apply

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const IDS = args.filter(a => !a.startsWith('--'));
const pi = args.indexOf('--project');
const PROJECT_ID = pi >= 0 ? args[pi + 1] : 'hom-pos-52710474-ceeea';
if (!IDS.length) { console.error('Usage: node scripts/collapse-duplicate-payments.mjs <INV-ID...> [--apply]'); process.exit(1); }

const _fetch = globalThis.fetch;
async function fetch(url, opts) {
  let last;
  for (let i = 1; i <= 6; i++) {
    try { return await _fetch(url, opts); } catch (e) { last = e; await new Promise(r => setTimeout(r, 600 * i)); }
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
const B = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const toFs = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; for (const [k, vv] of Object.entries(v)) f[k] = toFs(vv); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
};
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

async function getDoc(path) {
  const r = await fetch(`${B}/${path}`, { headers: H });
  if (!r.ok) return null;
  return ext(await r.json());
}
async function listAll(coll) {
  const all = []; let pt = '';
  do {
    const d = await fetch(`${B}/${coll}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: H }).then(r => r.json());
    if (d.documents) all.push(...d.documents.map(ext));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}
async function patch(path, fields) {
  const p = new URLSearchParams();
  for (const f of Object.keys(fields)) p.append('updateMask.fieldPaths', f);
  const fsF = {}; for (const [k, v] of Object.entries(fields)) fsF[k] = toFs(v);
  const r = await fetch(`${B}/${path}?${p}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fsF }),
  });
  if (!r.ok) throw new Error(`patch ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
async function del(path) {
  const r = await fetch(`${B}/${path}`, { method: 'DELETE', headers: H });
  if (!r.ok && r.status !== 200) throw new Error(`delete ${path}: ${r.status}`);
}

const money = n => 'PKR ' + Math.round(Number(n) || 0).toLocaleString('en-PK');
const day = iso => String(iso || '').slice(0, 10);

console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}  →  ${PROJECT_ID}\n`);

const [hisaab, logs] = await Promise.all([listAll('hisaab'), listAll('activity_log')]);
const backup = [];

for (const id of IDS) {
  const inv = await getDoc(`invoices/${id}`);
  if (!inv) { console.log(`⚠️  ${id}: not found`); continue; }

  const ph = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
  // Keep the earliest entry of each (amount, day) pair; the rest are repeats.
  const byTime = ph.map((p, i) => ({ p, i })).sort((a, b) => String(a.p.date).localeCompare(String(b.p.date)));
  const keep = new Set(); const seen = new Set();
  for (const { p, i } of byTime) {
    const key = `${Number(p.amount)}|${day(p.date)}`;
    if (seen.has(key)) continue;
    seen.add(key); keep.add(i);
  }
  const newHistory = ph.filter((_, i) => keep.has(i));
  const removed = ph.filter((_, i) => !keep.has(i));
  if (!removed.length) { console.log(`✅ ${id}: no duplicates`); continue; }

  const grandTotal = Number(inv.grandTotal || 0);
  const newPaid = newHistory.reduce((s, p) => s + Number(p.amount || 0), 0);
  const newBalance = grandTotal - newPaid;

  console.log(`${id}  ${inv.customerName || 'Walk-in'}`);
  ph.forEach((p, i) => console.log(`   ${keep.has(i) ? 'keep  ' : 'REMOVE'} ${money(p.amount)}  ${p.date}`));
  console.log(`   amountPaid ${money(inv.amountPaid)} → ${money(newPaid)}`);
  console.log(`   balanceDue ${money(inv.balanceDue)} → ${money(newBalance)}`);

  // Duplicate log lines for the same payment amount on this invoice
  const amounts = new Set(removed.map(r => Math.round(Number(r.amount || 0)).toLocaleString('en-PK')));
  const related = logs
    .filter(l => l.eventType === 'invoice.payment' && l.entityId === id &&
                 [...amounts].some(a => String(l.details || '').includes(a)))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const keptPerAmount = new Set();
  const logsToDelete = [];
  for (const l of related) {
    const amt = [...amounts].find(a => String(l.details || '').includes(a));
    if (!keptPerAmount.has(amt)) { keptPerAmount.add(amt); continue; }  // keep the first
    logsToDelete.push(l);
  }
  console.log(`   activity-log lines to delete: ${logsToDelete.length}`);

  const debits = hisaab.filter(h => h.linkedInvoiceId === id && Number(h.cashDebit || 0) > 0);
  console.log(`   linked hisaab debit rows: ${debits.length}\n`);

  if (!APPLY) continue;

  backup.push({ invoiceId: id, paymentHistory: ph, amountPaid: inv.amountPaid, balanceDue: inv.balanceDue,
                deletedLogs: logsToDelete.map(l => ({ id: l._id, timestamp: l.timestamp, details: l.details })) });

  await patch(`invoices/${id}`, { paymentHistory: newHistory, amountPaid: newPaid, balanceDue: newBalance });
  if (newBalance <= 0) {
    for (const d of debits) await del(`hisaab/${d._id}`);
  } else if (debits.length) {
    await patch(`hisaab/${debits[0]._id}`, { cashDebit: newBalance });
    for (const d of debits.slice(1)) await del(`hisaab/${d._id}`);
  }
  for (const l of logsToDelete) await del(`activity_log/${l._id}`);
  console.log(`   ✅ ${id} fixed\n`);
}

if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }
if (backup.length) {
  const out = `scripts/collapse-duplicate-payments.${Date.now()}.json`;
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), project: PROJECT_ID, backup }, null, 2));
  console.log(`Backup: ${out}`);
}
