// Read-only audit of every stored phone number.
//
// The contact field used to sit behind a fixed +92, so a number typed the way
// people write it here — 0300 1234567 — was stored as +920300 1234567: a trunk
// prefix that only belongs on a domestic call, kept inside an international
// number. Others were never normalised at all and sit as bare 03xxxxxxxxx.
// Both are the same person; a WhatsApp send to the wrong spelling fails.
//
// Writes nothing. Run fix-phone-numbers.mjs once these findings are confirmed.

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { parsePhoneNumberFromString, getCountryCallingCode } from 'libphonenumber-js';

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

const val = v => v == null ? undefined
  : 'stringValue' in v ? v.stringValue
  : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(val)
  : undefined;

async function all(collection) {
  const out = [];
  let pageToken;
  do {
    const url = `${FB}/${collection}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`${collection}: ${res.status} ${await res.text()}`);
    const json = await res.json();
    for (const d of json.documents || []) {
      const fields = {};
      for (const [k, v] of Object.entries(d.fields || {})) fields[k] = val(v);
      out.push({ id: d.name.split('/').pop(), fields });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * The canonical form, or null when the value cannot be salvaged.
 *
 * Mirrors toE164 in components/ui/phone-field.tsx. The calling code is looked
 * up rather than guessed: a greedy /^\+\d{1,3}0/ reads "+92 3000118653" as
 * country "+923" followed by a trunk zero, and deletes a real digit from a
 * perfectly valid number.
 */
function canonical(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const compact = raw.trim().replace(/[\s\-().]/g, '').replace(/^'+/, '');
  if (!compact) return null;

  const cc = getCountryCallingCode('PK');

  // A pasted number sometimes carries the code twice — "+92 +92 333 …".
  let cleaned = compact;
  while (cleaned.startsWith(`+${cc}+${cc}`)) cleaned = `+${cc}${cleaned.slice(2 * cc.length + 2)}`;

  const withoutTrunk = cleaned.startsWith(`+${cc}0`)
    ? `+${cc}${cleaned.slice(cc.length + 2)}`
    : cleaned;

  const stripped = parsePhoneNumberFromString(withoutTrunk, 'PK');
  if (stripped?.isValid()) return stripped.number;

  const asIs = parsePhoneNumberFromString(cleaned, 'PK');
  if (asIs?.isValid()) return asIs.number;

  return null;
}

const TARGETS = [
  { collection: 'customers', fields: ['phone'] },
  { collection: 'karigars',  fields: ['contact'] },
  { collection: 'invoices',  fields: ['customerContact'] },
  { collection: 'orders',    fields: ['customerContact'] },
];

const report = { project: PROJECT_ID, takenAt: new Date().toISOString(), collections: {} };
let totalNeedsFix = 0, totalUnsalvageable = 0, totalOk = 0, totalEmpty = 0;

for (const { collection, fields } of TARGETS) {
  const docs = await all(collection);
  const rows = { total: docs.length, empty: 0, alreadyCanonical: 0, needsFix: [], unsalvageable: [] };
  for (const d of docs) {
    for (const f of fields) {
      const raw = d.fields[f];
      if (raw === undefined || raw === null || String(raw).trim() === '') { rows.empty++; continue; }
      const fixed = canonical(String(raw));
      if (fixed === null) {
        rows.unsalvageable.push({ id: d.id, field: f, raw: String(raw) });
      } else if (fixed !== String(raw)) {
        rows.needsFix.push({ id: d.id, field: f, from: String(raw), to: fixed });
      } else {
        rows.alreadyCanonical++;
      }
    }
  }
  report.collections[collection] = rows;
  totalNeedsFix += rows.needsFix.length;
  totalUnsalvageable += rows.unsalvageable.length;
  totalOk += rows.alreadyCanonical;
  totalEmpty += rows.empty;
  console.log(`${collection.padEnd(11)} ${String(rows.total).padStart(5)} docs · ${String(rows.alreadyCanonical).padStart(4)} already fine · ${String(rows.needsFix.length).padStart(4)} to fix · ${String(rows.unsalvageable.length).padStart(3)} unsalvageable · ${rows.empty} blank`);
}

console.log(`\nTOTAL  ${totalOk} fine · ${totalNeedsFix} to fix · ${totalUnsalvageable} unsalvageable · ${totalEmpty} blank`);

// What the fixes actually look like.
const sample = Object.values(report.collections).flatMap(c => c.needsFix).slice(0, 12);
if (sample.length) {
  console.log('\nsample of the changes:');
  for (const s of sample) console.log(`  ${s.id.padEnd(22)} ${s.field.padEnd(16)} ${s.from.padEnd(20)} → ${s.to}`);
}
const bad = Object.values(report.collections).flatMap(c => c.unsalvageable).slice(0, 12);
if (bad.length) {
  console.log('\nunsalvageable (left alone):');
  for (const s of bad) console.log(`  ${s.id.padEnd(22)} ${s.field.padEnd(16)} ${JSON.stringify(s.raw)}`);
}

const out = `scripts/audit-phone-numbers.${Date.now()}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nfull report → ${out}`);
