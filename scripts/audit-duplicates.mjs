// Read-only audit for duplicate / inconsistent money records.
//
// The double-click bug that produced three identical PKR 12,000 payments on
// INV-000236 is the motivating case: a repeated write leaves an invoice that
// looks paid twice, a hisaab row that no longer matches, and a stack of
// identical activity-log lines. This checks every place that can happen.
//
//   node scripts/audit-duplicates.mjs                          # MINA
//   node scripts/audit-duplicates.mjs --project gemstrack-pos  # Taheri
//
// Writes nothing. Use the targeted fix scripts to act on anything it finds.

import { readFileSync } from 'fs';
import { homedir } from 'os';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const args = process.argv.slice(2);
const pi = args.indexOf('--project');
const PROJECT_ID = pi >= 0 ? args[pi + 1] : 'hom-pos-52710474-ceeea';
const STORE = PROJECT_ID === 'gemstrack-pos' ? 'Taheri' : 'MINA';
/** Two writes this close together are almost certainly one intended action. */
const BURST_SECONDS = 120;

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
    const d = await fetch(`${B}/${coll}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: H }).then(r => r.json());
    if (d.documents) all.push(...d.documents.map(ext));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}

const money = n => 'PKR ' + Math.round(Number(n) || 0).toLocaleString('en-PK');
const day = iso => String(iso || '').slice(0, 10);
const secsBetween = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 1000;

console.log(`\nDuplicate audit — ${STORE} (${PROJECT_ID})\n${'='.repeat(64)}`);

const [invoices, expenses, hisaab, logs, revenue] = await Promise.all([
  listAll('invoices'), listAll('expenses'), listAll('hisaab'),
  listAll('activity_log'), listAll('additional_revenue'),
]);

const findings = [];

// ── 1. Repeated payments inside an invoice ────────────────────────────────
let dupPayments = 0;
for (const inv of invoices) {
  const ph = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
  if (ph.length < 2) continue;
  const flagged = [];
  for (let i = 0; i < ph.length; i++) {
    for (let j = i + 1; j < ph.length; j++) {
      if (Number(ph[i].amount) !== Number(ph[j].amount)) continue;
      const burst = secsBetween(ph[i].date, ph[j].date) <= BURST_SECONDS;
      const sameDay = day(ph[i].date) === day(ph[j].date);
      if (burst || sameDay) flagged.push({ i, j, amount: Number(ph[i].amount), burst, gap: Math.round(secsBetween(ph[i].date, ph[j].date)) });
    }
  }
  if (flagged.length) {
    dupPayments += flagged.length;
    findings.push({
      kind: 'payment', id: inv._id, customer: inv.customerName || 'Walk-in',
      detail: flagged.map(f => `${money(f.amount)} x2 ${f.burst ? `${f.gap}s apart` : 'same day'}`).join(', '),
      extra: `paid ${money(inv.amountPaid)} of ${money(inv.grandTotal)}`,
    });
  }
}

// ── 2. Invoices paid beyond their total (a duplicate's usual symptom) ─────
const overpaid = invoices.filter(i => Number(i.amountPaid || 0) - Number(i.grandTotal || 0) > 1);

// ── 3. Duplicate expenses ────────────────────────────────────────────────
const expSeen = new Map();
for (const e of expenses) {
  const key = `${Number(e.amount || 0)}|${day(e.date || e.createdAt)}|${String(e.description || '').trim().toLowerCase()}`;
  (expSeen.get(key) || expSeen.set(key, []).get(key)).push(e);
}
const dupExpenses = [...expSeen.values()].filter(g => g.length > 1);

// ── 4. Multiple outstanding-balance rows for one invoice ─────────────────
const hisaabByInv = new Map();
for (const h of hisaab) {
  if (!h.linkedInvoiceId || !(Number(h.cashDebit || 0) > 0)) continue;
  (hisaabByInv.get(h.linkedInvoiceId) || hisaabByInv.set(h.linkedInvoiceId, []).get(h.linkedInvoiceId)).push(h);
}
const dupHisaab = [...hisaabByInv.entries()].filter(([, v]) => v.length > 1);

// ── 5. Hisaab rows that disagree with the invoice they track ─────────────
const invById = new Map(invoices.map(i => [i._id, i]));
const staleHisaab = [];
for (const [invId, rows] of hisaabByInv) {
  const inv = invById.get(invId);
  if (!inv) { staleHisaab.push({ invId, reason: 'invoice no longer exists', rows: rows.length }); continue; }
  const bal = Number(inv.balanceDue || 0);
  const tracked = rows.reduce((s, r) => s + Number(r.cashDebit || 0), 0);
  if (Math.abs(tracked - bal) > 1) staleHisaab.push({ invId, reason: `hisaab says ${money(tracked)}, invoice says ${money(bal)}`, rows: rows.length });
}

// ── 6. Repeated activity-log lines ───────────────────────────────────────
const logGroups = new Map();
for (const l of logs) {
  if (!l.entityId) continue;
  const key = `${l.eventType}|${l.entityId}|${String(l.details || '').trim()}`;
  (logGroups.get(key) || logGroups.set(key, []).get(key)).push(l);
}
const dupLogs = [...logGroups.entries()]
  .filter(([, v]) => v.length > 1)
  .map(([key, v]) => {
    const times = v.map(x => x.timestamp).sort();
    return { key, count: v.length, burst: secsBetween(times[0], times[times.length - 1]) <= BURST_SECONDS };
  })
  .filter(g => g.burst);

// ── 7. Duplicate extra-revenue entries ───────────────────────────────────
const revSeen = new Map();
for (const r of revenue) {
  const key = `${Number(r.amount || 0)}|${day(r.date)}|${String(r.description || '').trim().toLowerCase()}`;
  (revSeen.get(key) || revSeen.set(key, []).get(key)).push(r);
}
const dupRevenue = [...revSeen.values()].filter(g => g.length > 1);

// ── report ───────────────────────────────────────────────────────────────
function section(title, count, render) {
  console.log(`\n${count ? '⚠️ ' : '✅'} ${title}: ${count}`);
  if (count) render();
}

section('Invoices with repeated payments', findings.length, () => {
  findings.forEach(f => {
    console.log(`   ${f.id.padEnd(14)} ${String(f.customer).slice(0, 22).padEnd(24)} ${f.detail}`);
    console.log(`   ${''.padEnd(14)} ${f.extra}`);
  });
});

section('Invoices paid beyond their total', overpaid.length, () => {
  overpaid.forEach(i => console.log(`   ${i._id.padEnd(14)} ${String(i.customerName || '').slice(0, 22).padEnd(24)} paid ${money(i.amountPaid)} of ${money(i.grandTotal)}  → over by ${money(Number(i.amountPaid) - Number(i.grandTotal))}`));
});

section('Duplicate expenses (same amount, day, description)', dupExpenses.length, () => {
  dupExpenses.forEach(g => console.log(`   x${g.length}  ${day(g[0].date || g[0].createdAt)}  ${money(g[0].amount).padEnd(16)} ${String(g[0].description || '').slice(0, 46)}`));
});

section('Invoices with more than one outstanding-balance row', dupHisaab.length, () => {
  dupHisaab.forEach(([id, rows]) => console.log(`   ${id.padEnd(14)} ${rows.length} rows totalling ${money(rows.reduce((s, r) => s + Number(r.cashDebit || 0), 0))}`));
});

section('Hisaab rows that disagree with their invoice', staleHisaab.length, () => {
  staleHisaab.forEach(x => console.log(`   ${String(x.invId).padEnd(14)} ${x.reason}`));
});

section(`Activity-log lines repeated within ${BURST_SECONDS}s`, dupLogs.length, () => {
  dupLogs.slice(0, 20).forEach(g => {
    const [type, entity, details] = g.key.split('|');
    console.log(`   x${g.count}  ${type.padEnd(18)} ${entity.padEnd(14)} ${String(details).slice(0, 42)}`);
  });
  if (dupLogs.length > 20) console.log(`   … and ${dupLogs.length - 20} more`);
});

section('Duplicate extra-revenue entries', dupRevenue.length, () => {
  dupRevenue.forEach(g => console.log(`   x${g.length}  ${day(g[0].date)}  ${money(g[0].amount).padEnd(16)} ${String(g[0].description || '').slice(0, 42)}`));
});

const total = findings.length + overpaid.length + dupExpenses.length + dupHisaab.length + staleHisaab.length + dupLogs.length + dupRevenue.length;
console.log(`\n${'='.repeat(64)}`);
console.log(total ? `${total} issue group(s) need a look. Nothing was changed.` : 'Clean — no duplicates found. Nothing was changed.');
