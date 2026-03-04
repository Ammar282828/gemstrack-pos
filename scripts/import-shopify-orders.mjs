import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, writeBatch, updateDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = {
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
  storageBucket: "hom-pos-52710474-ceeea.firebasestorage.app",
  messagingSenderId: "288366939838",
  appId: "1:288366939838:web:044c8eec0a5610688798ef"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Parse CSV (handles quoted fields with commas) ---
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVRow(line);
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] || '').trim(); });
    return row;
  });
}

function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function main() {
  const content = fs.readFileSync('/Users/ammarmansa/gemstrack-pos/orders_export_1.csv', 'utf8');
  const rows = parseCSV(content);
  console.log(`Parsed ${rows.length} rows`);

  // Get current lastInvoiceNumber
  const settingsSnap = await getDoc(doc(db, 'app_settings', 'global'));
  let lastInvoiceNumber = settingsSnap.data()?.lastInvoiceNumber || 7;
  console.log(`Starting from INV-${(lastInvoiceNumber + 1).toString().padStart(6, '0')}`);

  // Load existing customers for matching
  const customersSnap = await getDocs(collection(db, 'customers'));
  const customerMap = {};
  customersSnap.docs.forEach(d => {
    const name = (d.data().name || '').toLowerCase().trim();
    customerMap[name] = { id: d.id, ...d.data() };
  });

  // Process in batches of 400 (Firestore batch limit is 500)
  let batch = writeBatch(db);
  let batchCount = 0;
  let imported = 0;

  const sortedRows = [...rows].sort((a, b) =>
    new Date(a['Created at']).getTime() - new Date(b['Created at']).getTime()
  );

  for (const row of sortedRows) {
    const shopifyName = row['Name']; // e.g. #1140
    const createdAt = row['Created at'] ? new Date(row['Created at']).toISOString() : new Date().toISOString();
    const billingName = row['Billing Name'] || row['Shipping Name'] || 'Walk-in Customer';
    const total = parseFloat(row['Total']) || 0;
    const subtotal = parseFloat(row['Subtotal']) || total;
    const discount = parseFloat(row['Discount Amount']) || 0;
    const financialStatus = row['Financial Status'] || 'paid';
    const amountPaid = financialStatus === 'paid' ? total : 0;
    const balanceDue = total - amountPaid;
    const itemName = row['Lineitem name'] || 'Item';
    const itemPrice = parseFloat(row['Lineitem price']) || total;
    const itemQty = parseInt(row['Lineitem quantity']) || 1;
    const itemSku = row['Lineitem sku'] || `SHOP-${shopifyName.replace('#', '')}`;

    // Match customer
    const nameLower = billingName.toLowerCase().trim();
    const customer = customerMap[nameLower];

    lastInvoiceNumber++;
    const invoiceId = `INV-${lastInvoiceNumber.toString().padStart(6, '0')}`;

    const invoice = {
      id: invoiceId,
      shopifyOrderName: shopifyName,
      customerId: customer?.id || '',
      customerName: billingName,
      customerContact: row['Billing Phone'] || row['Phone'] || '',
      items: [{
        sku: itemSku,
        name: itemName,
        categoryId: '',
        metalType: 'gold',
        karat: '21k',
        metalWeightG: 0,
        stoneWeightG: 0,
        quantity: itemQty,
        unitPrice: itemPrice,
        itemTotal: itemPrice * itemQty,
        metalCost: 0,
        wastageCost: 0,
        wastagePercentage: 0,
        makingCharges: itemPrice * itemQty,
        diamondChargesIfAny: 0,
        stoneChargesIfAny: 0,
        miscChargesIfAny: 0,
      }],
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

    batch.set(doc(db, 'invoices', invoiceId), invoice);
    batchCount++;
    imported++;

    if (batchCount >= 400) {
      await batch.commit();
      console.log(`  Committed batch (${imported} so far)`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  // Update lastInvoiceNumber
  await updateDoc(doc(db, 'app_settings', 'global'), { lastInvoiceNumber });

  console.log(`\n✅ Imported ${imported} invoices. lastInvoiceNumber → ${lastInvoiceNumber}`);
  console.log(`Next invoice will be INV-${(lastInvoiceNumber + 1).toString().padStart(6, '0')}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
