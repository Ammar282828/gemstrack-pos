import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, getDoc } from 'firebase/firestore';

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

function setDate(isoString, year, month, day) {
  const d = new Date(isoString || new Date().toISOString());
  d.setFullYear(year, month - 1, day);
  return d.toISOString();
}

async function main() {
  const ref = doc(db, 'orders', 'ORD-000002');
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const newDate = setDate(snap.data().createdAt, 2026, 1, 20);
    await updateDoc(ref, { createdAt: newDate });
    console.log(`✅ Order ORD-000002 (${snap.data().customerName}) → ${newDate.slice(0,10)}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
