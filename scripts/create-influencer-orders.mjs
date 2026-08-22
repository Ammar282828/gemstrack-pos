// Create zero-value PR gifting orders in Shopify for influencer seeding.
//
// Free product, no delivery charge, nothing to collect. Recorded as COD so the
// orders sit alongside normal COD sales, tagged pr-gift so they can be excluded
// from revenue reporting later.
//
//   node scripts/create-influencer-orders.mjs           # dry run
//   node scripts/create-influencer-orders.mjs --apply

import { readFileSync, writeFileSync } from 'fs';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const APPLY = process.argv.includes('--apply');
const _f = globalThis.fetch;
async function fetch(u, o) {
  let e;
  for (let i = 1; i <= 6; i++) {
    try { return await _f(u, o); } catch (x) { e = x; await new Promise(r => setTimeout(r, 700 * i)); }
  }
  throw e;
}

let shop = '', token = '';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (!m) continue;
  if (m[1] === 'SHOPIFY_STORE_DOMAIN') shop = m[2].trim();
  if (m[1] === 'SHOPIFY_ACCESS_TOKEN') token = m[2].trim();
}
if (!shop || !token) { console.error('Shopify creds missing'); process.exit(1); }
const H = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
const B = `https://${shop}/admin/api/2026-01`;

/** Local Pakistani numbers arrive without a country code. */
const phone = p => '+92' + String(p).replace(/\D/g, '').replace(/^0+/, '');

const INFLUENCERS = [
  { first: 'Alizay', last: 'ahmed',   ig: '@alizay__ahmed',   followers: '14.2k',
    address: 'DHA Phase 6, Nishat commercial, lane no 3. Building no 8c (Ahmed omes). 1st floor',
    city: 'Karachi', phone: '3333205044', product: 'Emani Pendant', deliverable: 'Reel' },
  { first: 'Areej', last: 'Malik',    ig: '@_.areeeej',       followers: '70.6k',
    address: '306-Q street 7, DHA phase 7, Lahore',
    city: 'Lahore',  phone: '3084263000', product: 'Gold Tennis Bracelet', deliverable: 'Story' },
  { first: 'Halah', last: 'dogar',    ig: '@halahdogar__',    followers: '58.3k',
    address: 'Askari 11, Sector A, 163#, Lahore',
    city: 'Lahore',  phone: '3374949097', product: 'Stackables', deliverable: 'Story' },
  { first: 'Sara',  last: '',         ig: '@_saras.archives', followers: '5.3k',
    address: 'D-82/1, shahid Ali khan road, Block F, North Nazimabad, Karachi',
    city: 'Karachi', phone: '3108233699', product: 'Emani Pendant', deliverable: 'Reel' },
  { first: 'Aliqa', last: 'shafqat',  ig: '@life_incurls',    followers: '5.1k',
    address: 'T5, fifth floor, block b, sea rock apartments, Clifton block 1',
    city: 'Karachi', phone: '3360657615', product: 'Emani Pendant', deliverable: 'Reel' },
];

function buildOrder(i) {
  return {
    order: {
      // A custom line item: no variant, so no size is guessed and no specific
      // variant's stock is decremented for a gifting order.
      line_items: [{
        title: `${i.product} — PR gift`,
        price: '0.00',
        quantity: 1,
        taxable: false,
        requires_shipping: true,
      }],
      customer: {
        first_name: i.first,
        last_name: i.last || i.ig.replace('@', ''),
        phone: phone(i.phone),
      },
      shipping_address: {
        first_name: i.first, last_name: i.last || '',
        address1: i.address, city: i.city,
        country: 'Pakistan', country_code: 'PK',
        phone: phone(i.phone),
      },
      billing_address: {
        first_name: i.first, last_name: i.last || '',
        address1: i.address, city: i.city,
        country: 'Pakistan', country_code: 'PK',
        phone: phone(i.phone),
      },
      // Nothing to collect and nothing to charge for delivery.
      financial_status: 'paid',
      shipping_lines: [],
      tax_exempt: true,
      taxes_included: true,
      gateway: 'Cash on Delivery (COD)',
      tags: 'pr-gift,influencer,seeding',
      note: `PR seeding — ${i.ig} (${i.followers}). Deliverable: ${i.deliverable}. Free gift, no delivery charge.`,
      // Never email these automatically.
      send_receipt: false,
      send_fulfillment_receipt: false,
    },
  };
}

console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}   →  ${shop}\n`);
for (const i of INFLUENCERS) {
  console.log(`${i.first} ${i.last}`.trim().padEnd(18) + `${i.ig}  (${i.followers})`);
  console.log(`   item      ${i.product} — PR gift   @ PKR 0`);
  console.log(`   ship to   ${i.address}, ${i.city}`);
  console.log(`   phone     ${phone(i.phone)}`);
  console.log(`   note      ${i.deliverable} · tags: pr-gift, influencer, seeding\n`);
}

if (!APPLY) { console.log('DRY RUN — nothing created. Re-run with --apply.'); process.exit(0); }

console.log('=== CREATING ===');
const created = [];
for (const i of INFLUENCERS) {
  const r = await fetch(`${B}/orders.json`, { method: 'POST', headers: H, body: JSON.stringify(buildOrder(i)) });
  const body = await r.json();
  if (!r.ok) {
    console.error(`  ✗ ${i.first}: ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
    continue;
  }
  const o = body.order;
  created.push({ name: `${i.first} ${i.last}`.trim(), orderNumber: o.order_number, id: o.id, total: o.total_price });
  console.log(`  ✅ ${String(i.first + ' ' + i.last).trim().padEnd(18)} → order #${o.order_number}  total ${o.total_price}`);
}
if (created.length) {
  const out = `scripts/create-influencer-orders.${Date.now()}.json`;
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), created }, null, 2));
  console.log(`\nCreated ${created.length}/${INFLUENCERS.length}. Log: ${out}`);
}
