// Report every customer with an outstanding invoice balance (balanceDue > 0),
// grouped by customer, with totals.
//   node scripts/who-owes-money.mjs

import { readFileSync } from 'fs';
import { homedir } from 'os';

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
async function listAll(coll) {
  const all = []; let pt = '';
  do {
    const d = await fetch(`${BASE}/${coll}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: H }).then(r => r.json());
    if (d.documents) all.push(...d.documents.map(ext));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}

const [invoices, customers] = await Promise.all([listAll('invoices'), listAll('customers')]);
const custById = new Map(customers.map(c => [c._id, c]));
const owing = invoices.filter(i => Number(i.balanceDue || 0) > 0.5);

// Group by customer (customerId when present, else normalized name)
const byCust = new Map();
for (const inv of owing) {
  const key = inv.customerId || `name:${(inv.customerName || 'Walk-in').trim().toLowerCase()}`;
  if (!byCust.has(key)) {
    const c = inv.customerId ? custById.get(inv.customerId) : null;
    byCust.set(key, {
      name: inv.customerName || 'Walk-in',
      phone: c?.phone || inv.customerContact || '',
      total: 0, invoices: [],
    });
  }
  const g = byCust.get(key);
  g.total += Number(inv.balanceDue || 0);
  g.invoices.push({ id: inv._id, bal: Number(inv.balanceDue || 0), created: inv.createdAt });
}

const groups = [...byCust.values()].sort((a, b) => b.total - a.total);
const grandTotal = groups.reduce((s, g) => s + g.total, 0);
const fmt = n => Number(n).toLocaleString('en-PK');
const dmy = iso => iso ? new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const daysOld = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : '';

console.log(`\n${groups.length} customer(s) owe money across ${owing.length} unpaid invoice(s).`);
console.log(`Total outstanding: PKR ${fmt(grandTotal)}\n`);
console.log('═'.repeat(88));
groups.forEach((g, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${g.name.padEnd(24)} PKR ${fmt(g.total).padStart(10)}   ${g.phone || 'no phone'}`);
  g.invoices.sort((a, b) => String(a.created).localeCompare(String(b.created))).forEach(x => {
    console.log(`      • ${x.id.padEnd(14)} PKR ${fmt(x.bal).padStart(9)}   ${dmy(x.created)}  (${daysOld(x.created)}d old)`);
  });
});
console.log('═'.repeat(88));
console.log(`TOTAL: PKR ${fmt(grandTotal)}  from ${groups.length} customers`);
