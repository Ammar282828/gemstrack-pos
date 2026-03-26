import fs from 'fs';
import os from 'os';
import path from 'path';

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const FIREBASE_TOOLS_AUTH_PATH = '/opt/homebrew/lib/node_modules/firebase-tools/lib/auth.js';
const FIREBASE_TOOLS_SCOPES_PATH = '/opt/homebrew/lib/node_modules/firebase-tools/lib/scopes.js';
const FIREBASE_TOOLS_CONFIG_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      fields[key] = toFirestoreValue(nestedValue);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) {
    const result = {};
    for (const [key, nestedValue] of Object.entries(value.mapValue.fields || {})) {
      result[key] = fromFirestoreValue(nestedValue);
    }
    return result;
  }
  return null;
}

function fromFirestoreDocument(doc) {
  const result = { id: doc.name.split('/').pop() };
  for (const [key, value] of Object.entries(doc.fields || {})) {
    result[key] = fromFirestoreValue(value);
  }
  return result;
}

async function getAccessToken() {
  const [{ getAccessToken }, scopes, configRaw] = await Promise.all([
    import(FIREBASE_TOOLS_AUTH_PATH),
    import(FIREBASE_TOOLS_SCOPES_PATH),
    fs.promises.readFile(FIREBASE_TOOLS_CONFIG_PATH, 'utf8'),
  ]);
  const config = JSON.parse(configRaw);
  const refreshToken = config?.tokens?.refresh_token;
  if (!refreshToken) {
    throw new Error(`No Firebase CLI refresh token found at ${FIREBASE_TOOLS_CONFIG_PATH}`);
  }
  const token = await getAccessToken(refreshToken, [scopes.CLOUD_PLATFORM]);
  return token.access_token;
}

async function firestoreFetchJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function listInvoices(token) {
  let pageToken = '';
  const invoices = [];

  do {
    const url = new URL(`${BASE_URL}/invoices`);
    url.searchParams.set('pageSize', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await firestoreFetchJson(url.toString(), token);
    invoices.push(...(payload.documents || []).map(fromFirestoreDocument));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);

  return invoices;
}

function getItemSubtotal(invoice) {
  return (invoice.items || []).reduce((sum, item) => sum + (item?.itemTotal || 0), 0);
}

function getExchangeTotal(invoice) {
  return (invoice.exchangeAmount1 || 0) + (invoice.exchangeAmount2 || 0);
}

function getExpectedAdjustments(invoice, itemSubtotal) {
  return (invoice.grandTotal || 0) - (itemSubtotal - (invoice.discountAmount || 0) - getExchangeTotal(invoice));
}

function hasMeaningfulDifference(a, b) {
  return Math.abs((a || 0) - (b || 0)) > 0.0001;
}

async function patchInvoice(token, invoiceId, fields) {
  const url = new URL(`${BASE_URL}/invoices/${invoiceId}`);
  for (const fieldPath of Object.keys(fields)) {
    url.searchParams.append('updateMask.fieldPaths', fieldPath);
  }

  await firestoreFetchJson(url.toString(), token, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, toFirestoreValue(value)])
      ),
    }),
  });
}

async function main() {
  const write = process.argv.includes('--write');
  const token = await getAccessToken();
  const invoices = await listInvoices(token);
  const shopifyInvoices = invoices.filter(invoice => invoice.source === 'shopify_import');
  const updates = [];

  for (const invoice of shopifyInvoices) {
    const itemSubtotal = getItemSubtotal(invoice);
    const adjustmentsAmount = getExpectedAdjustments(invoice, itemSubtotal);
    const currentAdjustments = invoice.adjustmentsAmount || 0;
    const needsSubtotal = hasMeaningfulDifference(invoice.subtotal || 0, itemSubtotal);
    const needsAdjustments = hasMeaningfulDifference(currentAdjustments, adjustmentsAmount);

    if (!needsSubtotal && !needsAdjustments) continue;

    updates.push({
      id: invoice.id,
      customerName: invoice.customerName,
      previousSubtotal: invoice.subtotal || 0,
      nextSubtotal: itemSubtotal,
      previousAdjustments: currentAdjustments,
      nextAdjustments: adjustmentsAmount,
      grandTotal: invoice.grandTotal || 0,
    });
  }

  const backupPath = path.join(
    os.tmpdir(),
    `shopify-invoice-adjustment-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  console.log(`Shopify-import invoices scanned: ${shopifyInvoices.length}`);
  console.log(`Invoices needing normalization: ${updates.length}`);

  if (updates.length > 0) {
    console.log('Sample changes:');
    for (const sample of updates.slice(0, 10)) {
      console.log(`  ${sample.id} | ${sample.customerName} | subtotal ${sample.previousSubtotal} -> ${sample.nextSubtotal} | adjustments ${sample.previousAdjustments} -> ${sample.nextAdjustments}`);
    }
  }

  if (!write) {
    console.log('\nDry run only. Re-run with --write to apply.');
    return;
  }

  await fs.promises.writeFile(backupPath, JSON.stringify(updates, null, 2));
  console.log(`Backup written to ${backupPath}`);

  for (const update of updates) {
    await patchInvoice(token, update.id, {
      subtotal: update.nextSubtotal,
      adjustmentsAmount: update.nextAdjustments,
    });
    console.log(`  Updated ${update.id}`);
  }

  console.log(`\nDone. Updated ${updates.length} Shopify-import invoice(s).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
