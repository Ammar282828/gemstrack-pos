import { readFileSync } from 'fs';
import { homedir } from 'os';

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const ORDER_ID = 'ORD-000016';

// Get refresh token from Firebase CLI login
const fbConfig = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const refreshToken = fbConfig.tokens.refresh_token;
const clientId = fbConfig.tokens.client_id || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const clientSecret = fbConfig.tokens.client_secret || 'j9iVZfS8kkCEFUPaAeJV0sAi';

// Exchange refresh token for access token
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }),
});
const { access_token } = await tokenRes.json();
if (!access_token) { console.error('Failed to get access token'); process.exit(1); }

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// First, read the current order to confirm
const getRes = await fetch(`${BASE}/orders/${ORDER_ID}`, {
  headers: { Authorization: `Bearer ${access_token}` },
});
const orderDoc = await getRes.json();
const invoiceId = orderDoc.fields?.invoiceId?.stringValue;
console.log(`Current state: ${ORDER_ID} has invoiceId = ${invoiceId}`);

if (invoiceId !== 'INV-000169') {
  console.log('Unexpected invoiceId — aborting for safety.');
  process.exit(1);
}

// Remove the invoiceId field using a PATCH with updateMask
// We set the field to null/remove it by patching without including it
// Firestore REST API: use updateMask to specify which fields to update
// To delete a field, include it in updateMask but don't include it in the document fields
const patchRes = await fetch(
  `${BASE}/orders/${ORDER_ID}?updateMask.fieldPaths=invoiceId`,
  {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        // intentionally omit invoiceId — this deletes the field
      },
    }),
  }
);

if (!patchRes.ok) {
  const err = await patchRes.text();
  console.error('PATCH failed:', patchRes.status, err);
  process.exit(1);
}

// Verify
const verifyRes = await fetch(`${BASE}/orders/${ORDER_ID}`, {
  headers: { Authorization: `Bearer ${access_token}` },
});
const updated = await verifyRes.json();
const newInvoiceId = updated.fields?.invoiceId?.stringValue;
console.log(`After fix: ${ORDER_ID} invoiceId = ${newInvoiceId ?? '(removed)'}`);
console.log('Done! Tahera Sheikh order (PKR 337,000) will now appear in revenue.');

process.exit(0);
