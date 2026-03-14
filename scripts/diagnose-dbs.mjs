import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

const homApp = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  authDomain: 'hom-pos-52710474-ceeea.firebaseapp.com',
  projectId: 'hom-pos-52710474-ceeea',
  storageBucket: 'hom-pos-52710474-ceeea.firebasestorage.app',
  messagingSenderId: '288366939838',
  appId: '1:288366939838:web:044c8eec0a5610688798ef',
}, 'hom');

const taheriApp = initializeApp({
  apiKey: 'AIzaSyAl3W_9_Z9j0sR7rGIwwM1uiiXvOxGQ7IA',
  authDomain: 'gemstrack-pos.firebaseapp.com',
  projectId: 'gemstrack-pos',
  storageBucket: 'gemstrack-pos.firebasestorage.app',
  messagingSenderId: '948018742883',
  appId: '1:948018742883:web:a3a090dde378be96089a56',
}, 'taheri');

const homDb    = getFirestore(homApp);
const taheriDb = getFirestore(taheriApp);

async function listInvoices(db, label) {
  console.log(`\n=== ${label} Invoices ===`);
  const snap = await getDocs(collection(db, 'invoices'));
  const all = [];
  snap.forEach(d => all.push({ id: d.id, ...d.data() }));
  all.sort((a, b) => a.id.localeCompare(b.id));
  if (all.length === 0) {
    console.log('  (no invoices)');
  } else {
    all.forEach(inv => {
      console.log(`  ${inv.id} — ${inv.customerName || '(no customer)'} — PKR ${inv.grandTotal}`);
    });
  }
  const counter = await getDoc(doc(db, 'settings', 'invoiceCounter'));
  console.log(`  lastInvoiceNumber: ${counter.exists() ? JSON.stringify(counter.data()) : '(no doc)'}`);
}

await listInvoices(homDb, 'HoM');
await listInvoices(taheriDb, 'Taheri');
