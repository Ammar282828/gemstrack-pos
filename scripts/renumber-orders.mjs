import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, writeBatch, updateDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
  storageBucket: "hom-pos-52710474-ceeea.firebasestorage.app",
  messagingSenderId: "288366939838",
  appId: "1:288366939838:web:044c8eec0a5610688798ef"
});
const db = getFirestore(app);

// Mapping: old → new
const REMAP = {
  'ORD-000001': 'ORD-000186',
  'ORD-000002': 'ORD-000187',
  'ORD-000003': 'ORD-000188',
  'ORD-000004': 'ORD-000189',
  'ORD-000005': 'ORD-000190',
  'ORD-000006': 'ORD-000191',
  'ORD-000007': 'ORD-000192',
  'ORD-000008': 'ORD-000193',
};

// Load all orders
const ordersSnap = await getDocs(collection(db, 'orders'));
const batch = writeBatch(db);

for (const oldDoc of ordersSnap.docs) {
  const newId = REMAP[oldDoc.id];
  if (!newId) continue;
  const data = { ...oldDoc.data(), id: newId };
  batch.set(doc(db, 'orders', newId), data);
  batch.delete(doc(db, 'orders', oldDoc.id));
  console.log(`  ${oldDoc.id} → ${newId} (${data.customerName})`);
}

await batch.commit();
console.log('Orders renumbered.');

// Update invoices with sourceOrderId
const invoicesSnap = await getDocs(collection(db, 'invoices'));
for (const invDoc of invoicesSnap.docs) {
  const sourceOrderId = invDoc.data().sourceOrderId;
  if (sourceOrderId && REMAP[sourceOrderId]) {
    await updateDoc(doc(db, 'invoices', invDoc.id), { sourceOrderId: REMAP[sourceOrderId] });
    console.log(`  Updated ${invDoc.id}.sourceOrderId: ${sourceOrderId} → ${REMAP[sourceOrderId]}`);
  }
}

// Update lastOrderNumber to 193
await updateDoc(doc(db, 'app_settings', 'global'), { lastOrderNumber: 193 });
console.log('\nlastOrderNumber → 193');
console.log('Next order will be ORD-000194');
process.exit(0);
