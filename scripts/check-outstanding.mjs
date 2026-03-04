import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy, addDoc } from 'firebase/firestore';

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

async function main() {
  // Check current hisaab entries
  const hisaabSnap = await getDocs(collection(db, 'hisaab'));
  console.log(`Current hisaab entries: ${hisaabSnap.docs.length}`);
  for (const d of hisaabSnap.docs) {
    const e = d.data();
    console.log(`  ${d.id} — ${e.entityName} | ${e.description} | debit:${e.cashDebit} credit:${e.cashCredit}`);
  }

  // Find invoices with outstanding balance
  const invoicesSnap = await getDocs(collection(db, 'invoices'));
  const outstanding = invoicesSnap.docs.filter(d => d.data().balanceDue > 0);
  console.log(`\nInvoices with outstanding balance: ${outstanding.length}`);

  for (const d of outstanding) {
    const inv = d.data();
    console.log(`  ${d.id} | ${inv.customerName} | balanceDue: ${inv.balanceDue}`);
  }

  // Backfill hisaab entries for existing outstanding invoices
  if (outstanding.length > 0) {
    console.log('\nBackfilling hisaab entries for outstanding invoices...');
    for (const d of outstanding) {
      const inv = d.data();
      // Check if entry already exists
      const existing = hisaabSnap.docs.find(h => h.data().linkedInvoiceId === d.id);
      if (existing) {
        console.log(`  ${d.id} — already has hisaab entry, skipping`);
        continue;
      }
      await addDoc(collection(db, 'hisaab'), {
        entityId: inv.customerId || 'walk-in',
        entityType: 'customer',
        entityName: inv.customerName || 'Walk-in Customer',
        date: inv.createdAt,
        description: `Outstanding balance for Invoice ${d.id}`,
        cashDebit: inv.balanceDue,
        cashCredit: 0,
        goldDebitGrams: 0,
        goldCreditGrams: 0,
        linkedInvoiceId: d.id,
      });
      console.log(`  ✅ Created hisaab entry for ${d.id} — ${inv.customerName}, balance: ${inv.balanceDue}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
