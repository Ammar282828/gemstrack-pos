import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
  storageBucket: "hom-pos-52710474-ceeea.firebasestorage.app",
  messagingSenderId: "288366939838",
  appId: "1:288366939838:web:044c8eec0a5610688798ef"
});
const db = getFirestore(app);

const [invoicesSnap, hisaabSnap, customersSnap] = await Promise.all([
  getDocs(collection(db, 'invoices')),
  getDocs(collection(db, 'hisaab')),
  getDocs(collection(db, 'customers')),
]);

// Index customers by ID and by normalized name
const customersById = {};
const customersByName = {};
for (const d of customersSnap.docs) {
  const c = d.data();
  customersById[d.id] = { id: d.id, ...c };
  customersByName[c.name?.toLowerCase().trim()] = { id: d.id, ...c };
}

// Index existing hisaab entries by linkedInvoiceId
const linkedByInvoice = {};
for (const d of hisaabSnap.docs) {
  const e = d.data();
  if (e.linkedInvoiceId) linkedByInvoice[e.linkedInvoiceId] = true;
}

console.log(`Invoices: ${invoicesSnap.docs.length} | Customers: ${customersSnap.docs.length} | Hisaab entries: ${hisaabSnap.docs.length}`);

let created = 0, skipped = 0, unmatched = 0;

for (const invDoc of invoicesSnap.docs) {
  const inv = invDoc.data();
  const invId = invDoc.id;
  const balance = parseFloat(inv.balanceDue ?? 0);

  if (balance <= 0 || inv.status === 'Refunded') continue;

  // Already has a hisaab entry
  if (linkedByInvoice[invId]) {
    console.log(`  SKIP (exists): ${invId} | ${inv.customerName}`);
    skipped++;
    continue;
  }

  // Resolve customer
  let customer = inv.customerId ? customersById[inv.customerId] : null;
  if (!customer && inv.customerName) {
    customer = customersByName[inv.customerName.toLowerCase().trim()];
  }

  if (!customer || !customer.id) {
    console.log(`  UNMATCHED (no customer found): ${invId} | "${inv.customerName}" | PKR ${balance}`);
    unmatched++;
    continue;
  }

  const date = inv.createdAt
    ? (typeof inv.createdAt.toDate === 'function'
        ? inv.createdAt.toDate().toISOString()
        : String(inv.createdAt))
    : new Date().toISOString();

  await addDoc(collection(db, 'hisaab'), {
    entityId: customer.id,
    entityType: 'customer',
    entityName: customer.name || inv.customerName,
    date,
    description: `Outstanding balance for Invoice ${invId}`,
    cashDebit: balance,
    cashCredit: 0,
    goldDebitGrams: 0,
    goldCreditGrams: 0,
    linkedInvoiceId: invId,
  });
  console.log(`  CREATED: ${invId} | ${customer.name} (id: ${customer.id}) | PKR ${balance}`);
  created++;
}

console.log(`\nDone — created: ${created}, skipped: ${skipped}, unmatched: ${unmatched}`);
if (unmatched > 0) {
  console.log('\nUnmatched invoices have no customer in the database — add those customers first.');
}
process.exit(0);
