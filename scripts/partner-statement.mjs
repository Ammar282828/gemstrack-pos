// Partner statement (from start of records).
// Computes accrual-basis net profit, cash on hand, and each 50% partner's
// capital account balance. Read-only.

import { readFileSync } from 'fs';
import { homedir } from 'os';

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
const FB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const auth = { Authorization: `Bearer ${access_token}` };

function extract(d) {
  const w = (v) => v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : (v.doubleValue !== undefined ? v.doubleValue : (v.booleanValue !== undefined ? v.booleanValue : (v.timestampValue ? v.timestampValue : (v.arrayValue ? (v.arrayValue.values||[]).map(w) : (v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,vv])=>[k,w(vv)])) : null))))));
  return { _id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,w(v)])) };
}
async function listAll(name) {
  const all = []; let pt = '';
  do {
    const r = await fetch(`${FB}/${name}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: auth });
    const d = await r.json();
    if (d.documents) all.push(...d.documents.map(extract));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}

const fmt = (n) => `PKR ${Math.round(Number(n) || 0).toLocaleString()}`;

console.log('Loading collections...');
const [invoices, orders, expenses, addRev, minaLedger, karigarBatches] = await Promise.all([
  listAll('invoices'),
  listAll('orders'),
  listAll('expenses'),
  listAll('additional_revenue'),
  listAll('mina_ledger'),
  listAll('karigar_batches'),
]);

// ─── Revenue (accrual, dashboard formula) ───
// Matches /analytics and / dashboard:
//   invoices.grandTotal (non-refunded)
//   + orders.subtotal (uninvoiced, not cancelled/refunded — work-in-progress)
//   + additional_revenue.amount
const activeInvoices = invoices.filter(i => i.status !== 'Refunded');
const invoiceRevenue = activeInvoices.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0);
const cashCollected = activeInvoices.reduce((s, i) => s + (Number(i.amountPaid) || 0), 0);
const outstanding = activeInvoices.reduce((s, i) => s + Math.max(0, Number(i.balanceDue) || 0), 0);
const overpaidCredit = activeInvoices.reduce((s, i) => s + Math.max(0, -(Number(i.balanceDue) || 0)), 0);

// Uninvoiced (in-progress) orders — counted as work-in-progress revenue
const wipOrders = orders.filter(o =>
  !o.invoiceId && o.status !== 'Cancelled' && o.status !== 'Refunded'
);
const orderRevenue = wipOrders.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
const orderAdvancesCollected = wipOrders.reduce((s, o) =>
  s + (Number(o.advancePayment) || 0) + (Number(o.advanceInExchangeValue) || 0), 0);

const totalRevenue = invoiceRevenue + orderRevenue;

// Source breakdown
const posOriginated = activeInvoices.filter(i => !i._id.startsWith('SHOPIFY-') && !(i.source && String(i.source).includes('shopify')));
const shopifyOriginated = activeInvoices.filter(i => i._id.startsWith('SHOPIFY-') || (i.source && String(i.source).includes('shopify')));
const posRevenue = posOriginated.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0);
const shopifyRevenue = shopifyOriginated.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0);

// ─── Expenses ───
const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

// ─── Additional revenue (non-sales) ───
const totalAddRev = addRev.reduce((s, e) => s + (Number(e.amount) || 0), 0);

// ─── Karigar payouts (closed batches) — INFORMATIONAL ONLY ───
// (Already included in `expenses` as line items; do NOT subtract again.)
const closedBatches = karigarBatches.filter(b => b.closedDate);
const totalKarigarPaid = closedBatches.reduce((s, b) => s + (Number(b.totalPaid) || 0), 0);

// ─── Mina's draws ───
// In mina_ledger the doc structure has type='payment' or type='withdrawal' —
// both represent money flowing OUT of the business TO Mina, so both count
// toward her draws against her capital account.
const minaDraws = minaLedger.reduce((s, m) => s + (Number(m.amount) || 0), 0);
const minaPayments = minaLedger.filter(m => m.type === 'payment').reduce((s, m) => s + Number(m.amount || 0), 0);
const minaWithdrawals = minaLedger.filter(m => m.type === 'withdrawal').reduce((s, m) => s + Number(m.amount || 0), 0);

// ─── Net profit (accrual) ───
// All-time profit before partner distributions.
// (totalKarigarPaid is informational — it's part of totalExpenses already.)
const netProfit = totalRevenue + totalAddRev - totalExpenses;
const eachShare = netProfit / 2;

// ─── Capital accounts ───
// Mina drew minaDraws so far; her capital balance = her share - draws
const minaCapital = eachShare - minaDraws;
// Ammar (you, the other 50% partner) drew nothing yet
const ammarCapital = eachShare - 0;

// ─── Cash on hand (rough) ───
// Cash collected from sales + additional revenue (assumed cash) - expenses
// (assumed paid in cash) - karigar payouts - Mina's draws.
// This is approximate because some expenses or additional revenues might not
// be cash settled at the time recorded.
const cashInflow = cashCollected + orderAdvancesCollected + totalAddRev;
const cashOutflow = totalExpenses + minaDraws;
const cashOnHand = cashInflow - cashOutflow;

const maxAmmarCanTake = Math.min(ammarCapital, cashOnHand);

// ─── Print ───
console.log('\n══════════════════════════════════════════════════════════════');
console.log('  HOUSE OF MINA — PARTNER STATEMENT (FROM START OF RECORDS)');
console.log('══════════════════════════════════════════════════════════════');

console.log('\nREVENUE (matches dashboard)');
console.log(`  Invoices (${activeInvoices.length}):                       ${fmt(invoiceRevenue)}`);
console.log(`    └─ POS-originated (${posOriginated.length}):              ${fmt(posRevenue)}`);
console.log(`    └─ Shopify-originated (${shopifyOriginated.length}):         ${fmt(shopifyRevenue)}`);
console.log(`  Orders in progress (${wipOrders.length} uninvoiced):       ${fmt(orderRevenue)}`);
console.log(`  Additional / extra revenue (${addRev.length}):           ${fmt(totalAddRev)}`);
console.log(`  ────────────────────────────────────────────────`);
console.log(`  Total revenue (dashboard total):        ${fmt(totalRevenue + totalAddRev)}`);

console.log('\n  Cash side:');
console.log(`    Cash collected from invoices:         ${fmt(cashCollected)}`);
console.log(`    Advances collected on open orders:    ${fmt(orderAdvancesCollected)}`);
console.log(`    Outstanding receivable on invoices:   ${fmt(outstanding)}`);
if (overpaidCredit > 0) console.log(`    Customer credit (overpayments):       ${fmt(overpaidCredit)}`);

console.log('\nEXPENSES');
console.log(`  Total (${expenses.length} entries — includes karigar):   ${fmt(totalExpenses)}`);
console.log(`    Of which closed karigar batches:      ${fmt(totalKarigarPaid)} (info only, already counted)`);

console.log('\nNET PROFIT (accrual: revenue + extra − expenses)');
console.log(`  ${fmt(totalRevenue)} + ${fmt(totalAddRev)} − ${fmt(totalExpenses)}`);
console.log(`  Net profit:                             ${fmt(netProfit)}`);
console.log(`  Each 50% partner's share:               ${fmt(eachShare)}`);

console.log("\nMINA'S CAPITAL ACCOUNT");
console.log(`  Her 50% share:                          ${fmt(eachShare)}`);
console.log(`  Less: payments to Mina (${minaLedger.filter(m => m.type === 'payment').length}):           ${fmt(minaPayments)}`);
console.log(`  Less: withdrawals by Mina (${minaLedger.filter(m => m.type === 'withdrawal').length}):       ${fmt(minaWithdrawals)}`);
console.log(`  Less: total draws so far:               ${fmt(minaDraws)}`);
console.log(`  ────────────────────────────────────────────────`);
console.log(`  Mina capital balance:                   ${fmt(minaCapital)}  ${minaCapital < 0 ? '(OVERDRAWN)' : ''}`);

console.log("\nYOUR CAPITAL ACCOUNT (50% partner — Ammar)");
console.log(`  Your 50% share:                         ${fmt(eachShare)}`);
console.log(`  Less: draws to date:                    ${fmt(0)}`);
console.log(`  ────────────────────────────────────────────────`);
console.log(`  Your capital balance:                   ${fmt(ammarCapital)}`);

console.log('\nCASH ON HAND (rough estimate)');
console.log(`  Cash collected from invoices:           ${fmt(cashCollected)}`);
console.log(`  + Order advances:                       ${fmt(orderAdvancesCollected)}`);
console.log(`  + Additional revenue:                   ${fmt(totalAddRev)}`);
console.log(`  − Expenses (incl. karigar):             ${fmt(totalExpenses)}`);
console.log(`  − Mina's draws:                         ${fmt(minaDraws)}`);
console.log(`  ────────────────────────────────────────────────`);
console.log(`  Estimated cash on hand:                 ${fmt(cashOnHand)}`);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  HOW MUCH YOU CAN TAKE NOW`);
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Limited by your capital balance:        ${fmt(ammarCapital)}`);
console.log(`  Limited by cash on hand:                ${fmt(cashOnHand)}`);
console.log(`  ────────────────────────────────────────────────`);
console.log(`  Safe maximum to withdraw:               ${fmt(maxAmmarCanTake)}`);
console.log('══════════════════════════════════════════════════════════════');

if (outstanding > 0) {
  console.log(`\nNote: PKR ${Math.round(outstanding).toLocaleString()} is still owed by customers (not yet collected). It's part of your accrual profit but not in cash on hand yet.`);
}
if (minaCapital < 0) {
  console.log(`\nNote: Mina has drawn more than her share — she is overdrawn by ${fmt(-minaCapital)}. That excess is effectively a loan from the partnership to her, or her share of future profits.`);
}
