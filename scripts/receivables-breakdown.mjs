// Break down "recognised revenue not yet collected" (analytics accrual-vs-cash gap):
//   A. Customer receivables      = Σ invoice.balanceDue  (non-refunded)
//   B. Uninvoiced open orders    = Σ (order.subtotal - advances) for open,
//                                  non-cancelled, not-yet-invoiced orders
// Mirrors src/app/analytics/page.tsx.  node scripts/receivables-breakdown.mjs

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
const fmt = n => 'PKR ' + Math.round(Number(n)).toLocaleString('en-PK');

const [invoices, orders] = await Promise.all([listAll('invoices'), listAll('orders')]);

// ── A. Customer receivables ──
const owing = invoices.filter(i => i.status !== 'Refunded' && Number(i.balanceDue || 0) > 0.5);
const receivables = owing.reduce((s, i) => s + Number(i.balanceDue || 0), 0);

// ── B. Uninvoiced open orders ──
const openOrders = orders.filter(o =>
  o && o.status !== 'Cancelled' && o.status !== 'Refunded' && !o.invoiceId);
let orderSubtotal = 0, orderAdvances = 0;
const orderRows = openOrders.map(o => {
  const sub = Number(o.subtotal || 0);
  const adv = (Number(o.advancePayment) || 0) + (Number(o.advanceInExchangeValue) || 0);
  orderSubtotal += sub; orderAdvances += adv;
  return { id: o._id, name: o.customerName || 'Walk-in', status: o.status, sub, adv, rem: sub - adv };
}).sort((a, b) => b.rem - a.rem);
const orderUncollected = orderSubtotal - orderAdvances;

const gap = receivables + orderUncollected;

console.log('\n══════════ RECOGNISED-BUT-NOT-COLLECTED — BREAKDOWN ══════════\n');
console.log(`A. Customer receivables (unpaid invoices) : ${fmt(receivables)}   (${owing.length} invoices)`);
console.log(`B. Uninvoiced open orders (remaining)     : ${fmt(orderUncollected)}   (${openOrders.length} orders)`);
console.log(`   ├ order value recognised (subtotals)   : ${fmt(orderSubtotal)}`);
console.log(`   └ advances already collected            : ${fmt(orderAdvances)}`);
console.log('   ' + '─'.repeat(52));
console.log(`   TOTAL NOT YET COLLECTED                  : ${fmt(gap)}\n`);

console.log('Top uninvoiced open orders by remaining owed:');
orderRows.slice(0, 15).forEach((o, i) =>
  console.log(`  ${String(i + 1).padStart(2)}. ${o.id.padEnd(12)} ${o.name.padEnd(22)} ${o.status.padEnd(12)} remaining ${fmt(o.rem)}  (sub ${fmt(o.sub)} − adv ${fmt(o.adv)})`));
