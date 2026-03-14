import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const homApp = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  authDomain: 'hom-pos-52710474-ceeea.firebaseapp.com',
  projectId: 'hom-pos-52710474-ceeea',
  storageBucket: 'hom-pos-52710474-ceeea.firebasestorage.app',
  messagingSenderId: '288366939838',
  appId: '1:288366939838:web:044c8eec0a5610688798ef',
}, 'hom');

const db = getFirestore(homApp);

async function show(id) {
  const snap = await getDoc(doc(db, 'invoices', id));
  if (!snap.exists()) {
    console.log(`${id}: not found`);
    return;
  }
  const d = snap.data();
  console.log(`\n=== ${id} ===`);
  console.log('Customer:', d.customerName);
  console.log('Total:   ', d.grandTotal);
  console.log('Date:    ', d.date || d.createdAt || d.invoiceDate);
  console.log('Items:   ', JSON.stringify(d.items, null, 2));
  console.log('Source:  ', d.source || d.importSource || '(none)');
  console.log('Notes:   ', d.notes || d.note || '(none)');
}

await show('INV-000001');
await show('INV-000152');
