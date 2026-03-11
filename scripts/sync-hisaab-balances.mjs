import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

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

const [invoicesSnap, hisaabSnap, customersSnap] = await Promise.all([
  getDocs(collection(db, 'invoices')),
  getDocs(collection(db, 'hisaab')),
  getDocs(collection(db, 'customers')),
]);

// Build name→customerId map for fallback matching on Shopify invoices with empty customerId
const customerByName = {};
for (const d of customersSnap.docs) {
  const c = d.data();
  if (c.name) customerByName[c.name.toLowerCase().trim()] = { id: d.id, name: c.name };
}

// Map existing hisaab entries by linkedInvoiceId
const linkedByInvoice = {};
for (const d of hisaabSnap.docs) {
  const data = d.data();
  if (!data.linkedInvoiceId) continue;
  if (!linkedByInvoice[data.linkedInvoiceId]) linkedByInvoice[data.linkedInvoiceId] = [];
  linkedByInvoice[data.linkedInvoiceId].push({ _ref: d.ref, ...data });
}

console.log(`Invoices: ${invoicesSnap.docs.length} | Hisaab entries: ${hisaabSnap.docs.length} | Customers: ${customersSnap.docs.length}`);

let created = 0, updated = 0, deleted = 0;
const batch = writeBatch(db);

for (const invDoc of invoicesSnap.docs) {
  const inv = { id: invDoc.id, ...invDoc.data() };
  const linked = linkedByInvoice[inv.id] || [];
  const balance = inv.balanceDue ?? 0;

  if (balance <= 0 || inv.status === 'Refunded') {
    linked.filter(h => (h.cashDebit ?? 0) > 0).forEach(h => { batch.delete(h._ref); deleted++; });
    continue;
  }

  // For Shopify invoices with missing customerId, try name-based fallback
  const resolvedCustomerId = inv.customerId || customerByName[inv.customerName?.toLowerCase().trim()]?.id || '';
  if (!resolvedCustomerId || resolvedCustomerId === 'walk-in') {
    if (!inv.customerId) console.log(`  SKIP (no customer match): ${inv.id} | "${inv.customerName}" | PKR ${balance}`);
    continue;
  }

  const debitEntries = linked.filter(h => (h.cashDebit ?? 0) > 0);

  if (debitEntries.length === 0) {
    const newRef = doc(collection(db, 'hisaab'));
    batch.set(newRef, {
      entityId: resolvedCustomerId,
      entityType: 'customer',
      entityName: inv.customerName || 'Customer',
      date: inv.createdAt,
      description: `Outstanding balance for Invoice ${inv.id}`,
      cashDebit: balance,
      cashCredit: 0,
      goldDebitGrams: 0,
      goldCreditGrams: 0,
      linkedInvoiceId: inv.id,
    });
    console.log(`  CREATED: ${inv.id} | ${inv.customerName} | PKR ${balance}`);
    created++;
  } else {
    if (debitEntries[0].cashDebit !== balance) {
      batch.update(debitEntries[0]._ref, { cashDebit: balance });
      console.log(`  UPDATED: ${inv.id} | ${inv.customerName} | ${debitEntries[0].cashDebit} -> ${balance}`);
      updated++;
    }
    debitEntries.slice(1).forEach(h => { batch.delete(h._ref); deleted++; });
  }
}

if (created + updated + deleted > 0) {
  await batch.commit();
  console.log(`\nDone — created: ${created}, updated: ${updated}, deleted: ${deleted}`);
} else {
  console.log('\nAll in sync, nothing to do.');
}
process.exit(0);
