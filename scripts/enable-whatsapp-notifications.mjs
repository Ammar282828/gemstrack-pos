// Enable WhatsApp notifications in the deployed POS settings and set recipients.
// The live app_settings/global doc predates the new toggle keys; the server-side
// scheduler reads raw Firestore (no default merge), so missing keys would skip.
// We set them explicitly.
//
// Usage:
//   node scripts/enable-whatsapp-notifications.mjs            # dry run
//   node scripts/enable-whatsapp-notifications.mjs --apply

import { readFileSync } from 'fs';
import { homedir } from 'os';

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'hom-pos-52710474-ceeea';

const PHONES = ['923262275554', '923161930960']; // Ammar, Mina
const TOGGLES = {
  notifEnabled: true,
  notifNewOrder: true,
  notifOrderCompleted: true,
  notifOrderCancelled: true,
  notifNewInvoice: true,
  notifPaymentReceived: true,
  notifDailyReport: true,
};

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
const H = { Authorization: `Bearer ${access_token}` };

function extractFields(doc) {
  const walk = (v) => {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(walk);
    if (v.mapValue !== undefined) { const o = {}; for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = walk(vv); return o; }
    return undefined;
  };
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = walk(v);
  return out;
}

const cur = await fetch(`${FB}/app_settings/global`, { headers: H }).then(r => r.json());
const curFields = extractFields(cur);
console.log('Current:  notifEnabled=%s  phones=%j', curFields.notifEnabled, curFields.notifPhones || []);
console.log('Will set: notifEnabled=true  phones=%j', PHONES);
console.log('Toggles:', TOGGLES);

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply.'); process.exit(0); }

// PATCH only the fields we touch (updateMask) so nothing else is disturbed.
const fields = {
  notifPhones: { arrayValue: { values: PHONES.map(p => ({ stringValue: p })) } },
};
for (const [k, v] of Object.entries(TOGGLES)) fields[k] = { booleanValue: v };

const params = new URLSearchParams();
params.append('updateMask.fieldPaths', 'notifPhones');
for (const k of Object.keys(TOGGLES)) params.append('updateMask.fieldPaths', k);

const res = await fetch(`${FB}/app_settings/global?${params.toString()}`, {
  method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields }),
});
if (!res.ok) { console.error('PATCH failed', res.status, await res.text()); process.exit(1); }
console.log('\n✓ Notifications enabled and recipients set.');
