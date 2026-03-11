import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  projectId: 'hom-pos-52710474-ceeea',
});
const db = getFirestore(app);

const [invSnap, hisaabSnap] = await Promise.all([
  getDocs(collection(db, 'invoices')),
  getDocs(collection(db, 'hisaab')),
]);

console.log('=== OUTSTANDING INVOICES (balanceDue > 0) ===');
let outstanding = 0;
for (const d of invSnap.docs) {
  const i = d.data();
  if ((i.balanceDue ?? 0) > 0 && i.status !== 'Refunded') {
    console.log(`${d.id} | "${i.customerName}" | cid:"${i.customerId}" | balance:${i.balanceDue} | source:${i.source || 'POS'}`);
    outstanding++;
  }
}
console.log(`Total outstanding: ${outstanding}`);

console.log('\n=== HISAAB ENTRIES ===');
for (const d of hisaabSnap.docs) {
  const h = d.data();
  console.log(`${d.id} | "${h.entityName}" | eid:"${h.entityId}" | debit:${h.cashDebit} | inv:${h.linkedInvoiceId || 'none'}`);
}
console.log(`Total entries: ${hisaabSnap.docs.length}`);
process.exit(0);
