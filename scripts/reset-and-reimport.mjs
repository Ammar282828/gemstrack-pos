import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch, updateDoc } from 'firebase/firestore';
import fs from 'fs';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
});
const db = getFirestore(app);

// --- CSV helpers ---
function parseCSVRow(line) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = parseCSVRow(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCSVRow(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
    return row;
  });
}

// --- Step 1: Delete all Shopify-imported invoices (INV-000008 to INV-000192) ---
console.log('Step 1: Deleting Shopify-imported invoices...');
const invoicesSnap = await getDocs(collection(db, 'invoices'));
const toDelete = invoicesSnap.docs.filter(d => {
  const num = parseInt(d.id.replace('INV-', ''));
  return num >= 8 && num <= 192;
});

let delBatch = writeBatch(db);
let delCount = 0;
for (const d of toDelete) {
  delBatch.delete(doc(db, 'invoices', d.id));
  delCount++;
  if (delCount % 400 === 0) {
    await delBatch.commit();
    delBatch = writeBatch(db);
  }
}
if (delCount % 400 !== 0) await delBatch.commit();
console.log(`  Deleted ${delCount} bad invoices.`);

// Reset lastInvoiceNumber to 7
await updateDoc(doc(db, 'app_settings', 'global'), { lastInvoiceNumber: 7 });
console.log('  Reset lastInvoiceNumber to 7.');

// --- Step 2: Parse CSV and group by order name ---
console.log('\nStep 2: Parsing CSV...');
const rows = parseCSV(fs.readFileSync('/Users/ammarmansa/gemstrack-pos/orders_export_1.csv', 'utf8'));

// Group rows by Name — only valid Shopify order names like #1001
const VALID_ORDER_NAME = /^#\d+$/;
const orderMap = new Map();
for (const row of rows) {
  const name = row['Name'];
  if (!name || !VALID_ORDER_NAME.test(name)) continue;
  if (!orderMap.has(name)) {
    orderMap.set(name, { header: row, items: [] });
  }
  // Add line item from every row
  orderMap.get(name).items.push(row);
}
console.log(`  ${rows.length} rows → ${orderMap.size} unique orders.`);

// Sort orders chronologically by Created at from the header row
const sortedOrders = [...orderMap.values()].sort((a, b) =>
  new Date(a.header['Created at']).getTime() - new Date(b.header['Created at']).getTime()
);

// --- Step 3: Import as invoices ---
console.log('\nStep 3: Importing...');
let lastInvoiceNumber = 7;
let impBatch = writeBatch(db);
let batchCount = 0;
let imported = 0;

for (const order of sortedOrders) {
  const h = order.header;
  const createdAt = h['Created at'] ? new Date(h['Created at']).toISOString() : new Date().toISOString();
  const billingName = h['Billing Name'] || h['Shipping Name'] || 'Walk-in Customer';
  const total = parseFloat(h['Total']) || 0;
  const subtotal = parseFloat(h['Subtotal']) || total;
  const discount = parseFloat(h['Discount Amount']) || 0;
  const financialStatus = h['Financial Status'] || 'paid';
  const amountPaid = financialStatus === 'paid' ? total : 0;
  const balanceDue = total - amountPaid;

  const items = order.items.map(row => {
    const price = parseFloat(row['Lineitem price']) || 0;
    const qty = parseInt(row['Lineitem quantity']) || 1;
    const sku = row['Lineitem sku'] || `SHOP-${h['Name'].replace('#', '')}-${row['Lineitem name']?.slice(0,8)}`;
    return {
      sku,
      name: row['Lineitem name'] || 'Item',
      categoryId: '',
      metalType: 'gold',
      karat: '21k',
      metalWeightG: 0,
      stoneWeightG: 0,
      quantity: qty,
      unitPrice: price,
      itemTotal: price * qty,
      metalCost: 0,
      wastageCost: 0,
      wastagePercentage: 0,
      makingCharges: price * qty,
      diamondChargesIfAny: 0,
      stoneChargesIfAny: 0,
      miscChargesIfAny: 0,
    };
  });

  lastInvoiceNumber++;
  const invoiceId = `INV-${String(lastInvoiceNumber).padStart(6, '0')}`;

  const invoice = {
    id: invoiceId,
    shopifyOrderName: h['Name'],
    customerId: '',
    customerName: billingName,
    customerContact: h['Billing Phone'] || h['Phone'] || '',
    items,
    subtotal,
    discountAmount: discount,
    grandTotal: total,
    amountPaid,
    balanceDue,
    createdAt,
    ratesApplied: {},
    paymentHistory: amountPaid > 0 ? [{ amount: amountPaid, date: createdAt, notes: 'Shopify payment' }] : [],
    source: 'shopify_import',
  };

  impBatch.set(doc(db, 'invoices', invoiceId), invoice);
  batchCount++;
  imported++;

  if (batchCount >= 400) {
    await impBatch.commit();
    console.log(`  Committed batch (${imported} so far)...`);
    impBatch = writeBatch(db);
    batchCount = 0;
  }
}

if (batchCount > 0) await impBatch.commit();

await updateDoc(doc(db, 'app_settings', 'global'), { lastInvoiceNumber });
console.log(`\n✅ Imported ${imported} invoices (INV-000008 → INV-${String(lastInvoiceNumber).padStart(6,'0')})`);
console.log(`lastInvoiceNumber → ${lastInvoiceNumber}`);
console.log(`Next invoice: INV-${String(lastInvoiceNumber + 1).padStart(6,'0')}`);
process.exit(0);
