import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  projectId: 'hom-pos-52710474-ceeea',
});
const db = getFirestore(app);

const snap = await getDocs(collection(db, 'invoices'));

let refunded = [];
let totalRevenue = 0;
let refundedRevenue = 0;

for (const d of snap.docs) {
  const inv = d.data();
  totalRevenue += inv.grandTotal || 0;
  if (inv.status === 'Refunded') {
    refunded.push({ id: d.id, customerName: inv.customerName, grandTotal: inv.grandTotal, createdAt: inv.createdAt });
    refundedRevenue += inv.grandTotal || 0;
  }
}

console.log(`Total invoices: ${snap.docs.length}`);
console.log(`Refunded invoices: ${refunded.length}`);
console.log(`Revenue lost from filter: PKR ${refundedRevenue.toLocaleString()}`);
console.log('');
if (refunded.length > 0) {
  console.log('Refunded invoices:');
  refunded.forEach(r => console.log(`  ${r.id} | "${r.customerName}" | PKR ${r.grandTotal} | ${r.createdAt}`));
} else {
  console.log('No invoices with status=Refunded found.');
}
process.exit(0);
