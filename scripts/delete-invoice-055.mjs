import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

const db = getFirestore(initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  authDomain: 'hom-pos-52710474-ceeea.firebaseapp.com',
  projectId: 'hom-pos-52710474-ceeea',
  storageBucket: 'hom-pos-52710474-ceeea.firebasestorage.app',
  messagingSenderId: '288366939838',
  appId: '1:288366939838:web:044c8eec0a5610688798ef'
}));

const INV = 'INV-000055';

await deleteDoc(doc(db, 'invoices', INV));
console.log('Deleted invoice', INV);

const snap = await getDocs(collection(db, 'hisaab'));
let deleted = 0;
for (const d of snap.docs) {
  if (d.data().linkedInvoiceId === INV) {
    await deleteDoc(doc(db, 'hisaab', d.id));
    console.log('Deleted hisaab entry', d.id);
    deleted++;
  }
}
console.log('Done. Hisaab entries removed:', deleted);
process.exit(0);
