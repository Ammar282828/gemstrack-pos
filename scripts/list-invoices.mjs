import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';

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
  const snap = await getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'asc')));
  console.log(`Total invoices: ${snap.docs.length}\n`);
  for (const d of snap.docs) {
    const inv = d.data();
    console.log(`${d.id} | ${inv.createdAt?.slice(0,19)} | ${inv.customerName} | Total: ${inv.grandTotal} | Paid: ${inv.amountPaid} | Balance: ${inv.balanceDue}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
