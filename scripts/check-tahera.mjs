import { readFileSync } from 'fs';
import { homedir } from 'os';

const PROJECT_ID = 'hom-pos-52710474-ceeea';

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

async function getCollection(name) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${name}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
    const data = await res.json();
    if (data.documents) docs.push(...data.documents);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function extractFields(doc) {
  const fields = doc.fields || {};
  const result = {};
  for (const [key, val] of Object.entries(fields)) {
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.integerValue !== undefined) result[key] = Number(val.integerValue);
    else if (val.doubleValue !== undefined) result[key] = val.doubleValue;
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.nullValue !== undefined) result[key] = null;
    else result[key] = JSON.stringify(val);
  }
  result._id = doc.name.split('/').pop();
  return result;
}

const [orderDocs, invoiceDocs] = await Promise.all([
  getCollection('orders'),
  getCollection('invoices'),
]);

const orders = orderDocs.map(extractFields);
const invoices = invoiceDocs.map(extractFields);
const existingInvoiceIds = new Set(invoices.map(i => i._id));

console.log('=== ORDERS WITH STALE invoiceId (invoice deleted but field remains) ===');
let found = false;
for (const o of orders) {
  if (o.invoiceId && !existingInvoiceIds.has(o.invoiceId)) {
    found = true;
    console.log(`ORDER ${o._id} | customer: ${o.customerName} | status: ${o.status} | subtotal: ${o.subtotal} | invoiceId: ${o.invoiceId} (DELETED)`);
  }
}
if (!found) console.log('None found.');

console.log('\n=== ALL TAHERA/SHEIKH ORDERS ===');
for (const o of orders) {
  const name = (o.customerName || '').toLowerCase();
  if (name.includes('tahera') || name.includes('sheikh')) {
    console.log(`ORDER ${o._id} | customer: ${o.customerName} | status: ${o.status} | subtotal: ${o.subtotal} | grandTotal: ${o.grandTotal} | invoiceId: ${o.invoiceId || 'NONE'}`);
  }
}

console.log('\n=== ALL TAHERA/SHEIKH INVOICES ===');
for (const i of invoices) {
  const name = (i.customerName || '').toLowerCase();
  if (name.includes('tahera') || name.includes('sheikh')) {
    console.log(`INVOICE ${i._id} | customer: ${i.customerName} | grandTotal: ${i.grandTotal} | sourceOrderId: ${i.sourceOrderId || 'NONE'}`);
  }
}

process.exit(0);
