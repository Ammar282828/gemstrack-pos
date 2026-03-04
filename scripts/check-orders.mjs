import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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

const [ordersSnap, invoicesSnap, hisaabSnap] = await Promise.all([
  getDocs(collection(db, 'orders')),
  getDocs(collection(db, 'invoices')),
  getDocs(collection(db, 'hisaab')),
]);

console.log('=== ORDERS ===');
for (const d of ordersSnap.docs) {
  const o = d.data();
  console.log(`${d.id} | ${o.customerName} | status:${o.status} | subtotal:${o.subtotal} | advance:${o.advancePayment||0} | grandTotal:${o.grandTotal}`);
}

console.log('\n=== INVOICES ===');
for (const d of invoicesSnap.docs) {
  const i = d.data();
  console.log(`${d.id} | ${i.customerName} | grandTotal:${i.grandTotal} | paid:${i.amountPaid} | balance:${i.balanceDue}`);
}

console.log('\n=== HISAAB ===');
for (const d of hisaabSnap.docs) {
  const h = d.data();
  console.log(`${d.id} | ${h.entityName} | ${h.description} | debit:${h.cashDebit} credit:${h.cashCredit}`);
}
process.exit(0);
