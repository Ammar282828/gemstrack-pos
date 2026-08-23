// Rewrite stored phone numbers into canonical E.164.
//
// Backs up every field it will touch first, then writes ONLY that one field
// per document via a field mask — nothing else in the record is sent, so a
// concurrent edit elsewhere in the document cannot be clobbered.
//
//   node scripts/fix-phone-numbers.mjs           # dry run, writes nothing
//   node scripts/fix-phone-numbers.mjs --apply   # writes

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { parsePhoneNumberFromString, getCountryCallingCode } from 'libphonenumber-js';

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = process.env.FB_PROJECT || 'hom-pos-52710474-ceeea';

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

const val = v => v == null ? undefined : ('stringValue' in v ? v.stringValue : undefined);

async function all(collection) {
  const out = [];
  let pageToken;
  do {
    const res = await fetch(`${FB}/${collection}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: auth });
    if (!res.ok) throw new Error(`${collection}: ${res.status} ${await res.text()}`);
    const json = await res.json();
    for (const d of json.documents || []) out.push({ id: d.name.split('/').pop(), fields: d.fields || {} });
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

/** Same rule as toE164 in components/ui/phone-field.tsx. */
function canonical(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const compact = raw.trim().replace(/[\s\-().]/g, '').replace(/^'+/, '');
  if (!compact) return null;
  const cc = getCountryCallingCode('PK');
  let cleaned = compact;
  while (cleaned.startsWith(`+${cc}+${cc}`)) cleaned = `+${cc}${cleaned.slice(2 * cc.length + 2)}`;
  const withoutTrunk = cleaned.startsWith(`+${cc}0`) ? `+${cc}${cleaned.slice(cc.length + 2)}` : cleaned;
  const stripped = parsePhoneNumberFromString(withoutTrunk, 'PK');
  if (stripped?.isValid()) return stripped.number;
  const asIs = parsePhoneNumberFromString(cleaned, 'PK');
  if (asIs?.isValid()) return asIs.number;
  return null;
}

const TARGETS = [
  { collection: 'customers', field: 'phone' },
  { collection: 'karigars',  field: 'contact' },
  { collection: 'invoices',  field: 'customerContact' },
  { collection: 'orders',    field: 'customerContact' },
];

const planned = [];
const skipped = [];
for (const { collection, field } of TARGETS) {
  for (const d of await all(collection)) {
    const raw = val(d.fields[field]);
    if (raw === undefined || String(raw).trim() === '') continue;
    const fixed = canonical(String(raw));
    if (fixed === null) { skipped.push({ collection, id: d.id, field, raw: String(raw) }); continue; }
    if (fixed !== String(raw)) planned.push({ collection, id: d.id, field, from: String(raw), to: fixed });
  }
}

console.log(`${planned.length} field${planned.length === 1 ? '' : 's'} to rewrite · ${skipped.length} left alone\n`);
for (const p of planned) console.log(`  ${p.collection.padEnd(10)} ${p.id.padEnd(30)} ${p.from.padEnd(22)} → ${p.to}`);
if (skipped.length) {
  console.log('\nleft alone — cannot be salvaged without inventing digits:');
  for (const s of skipped) console.log(`  ${s.collection.padEnd(10)} ${s.id.padEnd(30)} ${JSON.stringify(s.raw)}`);
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to make these changes.');
  process.exit(0);
}

// Back up the exact prior values before touching anything.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `backups/phone-numbers-${stamp}.json`;
writeFileSync(backup, JSON.stringify({ project: PROJECT_ID, takenAt: new Date().toISOString(), planned, skipped }, null, 2));
console.log(`\nbackup of prior values → ${backup}`);

let ok = 0; const failures = [];
for (const p of planned) {
  // Field mask: this one field is the entire write.
  const url = `${FB}/${p.collection}/${encodeURIComponent(p.id)}?updateMask.fieldPaths=${p.field}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [p.field]: { stringValue: p.to } } }),
  });
  if (res.ok) ok++;
  else failures.push({ ...p, status: res.status, body: (await res.text()).slice(0, 160) });
}

console.log(`\n${ok} written, ${failures.length} failed`);
for (const f of failures) console.log(`  FAILED ${f.collection}/${f.id}: ${f.status} ${f.body}`);
