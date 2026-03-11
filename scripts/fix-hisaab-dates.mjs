import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
  storageBucket: "hom-pos-52710474-ceeea.firebasestorage.app",
  messagingSenderId: "288366939838",
  appId: "1:288366939838:web:044c8eec0a5610688798ef"
});
const db = getFirestore(app);

const snap = await getDocs(collection(db, 'hisaab'));
console.log(`Total hisaab docs: ${snap.docs.length}`);

let fixed = 0, removed = 0;

for (const d of snap.docs) {
  const e = d.data();
  const ref = doc(db, 'hisaab', d.id);

  // Delete walk-in entries (no real customer to link to)
  if (!e.entityId || e.entityId === 'walk-in') {
    await deleteDoc(ref);
    console.log(`  DELETED walk-in entry: ${d.id} — ${e.description}`);
    removed++;
    continue;
  }

  // Fix Timestamp date -> ISO string
  const dateVal = e.date;
  if (dateVal && typeof dateVal === 'object' && typeof dateVal.toDate === 'function') {
    const isoString = dateVal.toDate().toISOString();
    await updateDoc(ref, { date: isoString });
    console.log(`  FIXED date: ${d.id} — ${e.entityName} | ${dateVal.toDate().toISOString()}`);
    fixed++;
  } else {
    console.log(`  OK: ${d.id} — ${e.entityName} | date: ${dateVal}`);
  }
}

console.log(`\nDone — fixed: ${fixed} dates, removed: ${removed} walk-in entries`);
process.exit(0);
