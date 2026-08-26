// Re-encode sample photos stored inside order documents.
//
// A reference photo was being kept as a base64 JPEG inside the order itself,
// at up to 1400px and 500KB. One such image is 273KB decoded — 56% of the
// entire orders collection — and every page that reads orders (Orders,
// Invoices, Workshop, the dashboard, analytics) downloads it.
//
// The photo only ever renders at 96px on the order page and smaller on the
// bench, so it is re-encoded to a size that suits that.
//
//   node scripts/shrink-order-sample-images.mjs           # dry run
//   node scripts/shrink-order-sample-images.mjs --apply

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import sharp from 'sharp';

const APPLY = process.argv.includes('--apply');
/** Still comfortably enough to zoom into a design detail. */
const MAX_EDGE = 1000;
const QUALITY = 72;

const PROJECT_ID = process.env.FB_PROJECT || 'hom-pos-52710474-ceeea';
const fb = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const tk = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: fb.tokens.refresh_token,
    client_id: fb.tokens.client_id || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: fb.tokens.client_secret || 'j9iVZfS8kkCEFUPaAeJV0sAi' }),
});
const { access_token } = await tk.json();
const FB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const auth = { Authorization: `Bearer ${access_token}` };

async function allOrders() {
  const out = []; let pt;
  do {
    const res = await fetch(`${FB}/orders?pageSize=300${pt ? `&pageToken=${pt}` : ''}`, { headers: auth });
    const j = await res.json();
    for (const d of j.documents || []) out.push({ id: d.name.split('/').pop(), fields: d.fields || {} });
    pt = j.nextPageToken;
  } while (pt);
  return out;
}

const plan = [];
for (const o of await allOrders()) {
  const items = o.fields.items?.arrayValue?.values || [];
  let changed = false;
  const rebuilt = [];
  for (const [i, it] of items.entries()) {
    const f = it.mapValue?.fields || {};
    const uri = f.sampleImageDataUri?.stringValue;
    if (!uri || !uri.startsWith('data:image/')) { rebuilt.push(it); continue; }

    const b64 = uri.slice(uri.indexOf(',') + 1);
    const input = Buffer.from(b64, 'base64');
    const meta = await sharp(input).metadata();
    const output = await sharp(input)
      .rotate()                                   // honour EXIF before dropping it
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();

    if (output.length >= input.length) { rebuilt.push(it); continue; }   // never make it bigger
    const next = `data:image/jpeg;base64,${output.toString('base64')}`;
    rebuilt.push({ mapValue: { fields: { ...f, sampleImageDataUri: { stringValue: next } } } });
    changed = true;
    plan.push({ orderId: o.id, itemIndex: i,
      fromKb: +(input.length / 1024).toFixed(0), toKb: +(output.length / 1024).toFixed(0),
      fromPx: `${meta.width}x${meta.height}`, previous: uri });
  }
  if (changed) plan.push.__order = true, (plan.rebuilt ||= {})[o.id] = rebuilt;
}

const shrinks = plan.filter(p => p.orderId);
console.log(`\n${shrinks.length} image(s) to re-encode (max ${MAX_EDGE}px, quality ${QUALITY})\n`);
let before = 0, after = 0;
for (const s of shrinks) {
  before += s.fromKb; after += s.toKb;
  console.log(`  ${s.orderId} item ${s.itemIndex + 1}: ${s.fromPx}  ${s.fromKb} KB → ${s.toKb} KB  (${Math.round((1 - s.toKb / s.fromKb) * 100)}% smaller)`);
}
if (shrinks.length) console.log(`\n  total ${before} KB → ${after} KB`);

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }
if (!shrinks.length) process.exit(0);

mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `backups/order-sample-images-${stamp}.json`;
writeFileSync(backup, JSON.stringify({ project: PROJECT_ID, takenAt: new Date().toISOString(), images: shrinks }, null, 2));
console.log(`\nbackup of the original images → ${backup}`);

let ok = 0;
for (const [orderId, items] of Object.entries(plan.rebuilt || {})) {
  // Field mask: only `items` is written.
  const res = await fetch(`${FB}/orders/${encodeURIComponent(orderId)}?updateMask.fieldPaths=items`, {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { items: { arrayValue: { values: items } } } }),
  });
  if (res.ok) ok++; else console.log(`  FAILED ${orderId}: ${res.status} ${(await res.text()).slice(0, 160)}`);
}
console.log(`\n${ok} order(s) updated`);
