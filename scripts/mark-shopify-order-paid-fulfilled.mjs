// Mark a Shopify order as paid (manual sale transaction) and fulfilled
// (creates a fulfillment per fulfillment_order). Idempotent: skips steps
// that have already been done.
//
// Usage:
//   node scripts/mark-shopify-order-paid-fulfilled.mjs <orderId>           # dry run
//   node scripts/mark-shopify-order-paid-fulfilled.mjs <orderId> --apply   # execute

import { readFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ORDER_ID = args.find(a => /^\d+$/.test(a));
if (!ORDER_ID) { console.error('Usage: node mark-shopify-order-paid-fulfilled.mjs <orderId> [--apply]'); process.exit(1); }

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const SHOPIFY_API_VERSION = '2026-01';

// ─── Firebase auth (only to read Shopify creds from app_settings) ───
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

const settingsRes = await fetch(`${FB_BASE}/app_settings/global`, { headers: { Authorization: `Bearer ${access_token}` } });
const settingsDoc = await settingsRes.json();
const shop = process.env.SHOPIFY_STORE_DOMAIN || settingsDoc.fields?.shopifyStoreDomain?.stringValue;
const token = process.env.SHOPIFY_ACCESS_TOKEN || settingsDoc.fields?.shopifyAccessToken?.stringValue;
if (!shop || !token) { console.error('Shopify creds missing'); process.exit(1); }

async function shopify(method, endpoint, body) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`, {
    method,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Shopify ${method} ${endpoint}: ${res.status} ${t.slice(0, 400)}`);
  }
  return res.json();
}

// 1) Fetch order
const { order } = await shopify('GET', `/orders/${ORDER_ID}.json`);
console.log(`Order #${order.order_number}  customer=${order.customer ? order.customer.first_name + ' ' + order.customer.last_name : '(none)'}`);
console.log(`  total=${order.total_price}  financial_status=${order.financial_status}  fulfillment_status=${order.fulfillment_status || 'unfulfilled'}`);

// 2) Determine which actions are needed
const needsPaid = order.financial_status !== 'paid';
const needsFulfilled = order.fulfillment_status !== 'fulfilled';

console.log(`\nWill: ${needsPaid ? 'create sale transaction (mark paid)' : 'skip payment (already paid)'}; ${needsFulfilled ? 'create fulfillments (mark fulfilled)' : 'skip fulfillment (already fulfilled)'}`);

// 3) Fetch fulfillment_orders if we need to fulfill
let fulfillmentOrders = [];
if (needsFulfilled) {
  const r = await shopify('GET', `/orders/${ORDER_ID}/fulfillment_orders.json`);
  fulfillmentOrders = r.fulfillment_orders || [];
  console.log(`Fulfillment orders: ${fulfillmentOrders.length}`);
  for (const fo of fulfillmentOrders) {
    console.log(`  fo_id=${fo.id}  status=${fo.status}  line_items=${fo.line_items?.length || 0}  location=${fo.assigned_location_id}`);
  }
}

if (!APPLY) {
  console.log('\nDRY RUN. Re-run with --apply to execute.');
  process.exit(0);
}

console.log('\n=== APPLYING ===');

// 4) Mark paid via a sale transaction
if (needsPaid) {
  const tr = await shopify('POST', `/orders/${ORDER_ID}/transactions.json`, {
    transaction: {
      kind: 'sale',
      status: 'success',
      amount: order.total_outstanding ?? order.total_price,
      currency: order.currency,
      gateway: 'manual',
      source: 'external',
    },
  });
  console.log(`Transaction created: id=${tr.transaction.id}  kind=${tr.transaction.kind}  status=${tr.transaction.status}  amount=${tr.transaction.amount}`);
}

// 5) Create fulfillment for each open fulfillment_order
if (needsFulfilled) {
  const open = fulfillmentOrders.filter(fo => fo.status === 'open' || fo.status === 'in_progress');
  if (!open.length) console.log('No open fulfillment orders.');
  for (const fo of open) {
    const ff = await shopify('POST', '/fulfillments.json', {
      fulfillment: {
        line_items_by_fulfillment_order: [{ fulfillment_order_id: fo.id }],
        notify_customer: false,
      },
    });
    console.log(`Fulfillment created: id=${ff.fulfillment.id}  status=${ff.fulfillment.status}  for fo_id=${fo.id}`);
  }
}

// 6) Re-fetch order and report final state
const { order: after } = await shopify('GET', `/orders/${ORDER_ID}.json`);
console.log(`\nFinal: financial_status=${after.financial_status}  fulfillment_status=${after.fulfillment_status || 'unfulfilled'}`);
