import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

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
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  const snap = await getDocs(collection(db, 'invoices'));
  const invoices = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Print all invoices so we can identify the right ones
  console.log('\n--- All invoices ---');
  invoices
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .forEach(inv => {
      console.log(`${inv.id} | ${(inv.createdAt || '').slice(0, 10)} | ${inv.customerName || '(no name)'} | grandTotal: ${inv.grandTotal}`);
    });

  // --- Fixes ---
  const fixes = [
    // Arifa invoice #150 → Feb 7 2026
    { match: inv => inv.id === 'INV-000150', year: 2026, month: 2, day: 7, label: 'INV-000150 Arifa → Feb 7' },
    // Lubaina invoice #144 → Feb 10 2026
    { match: inv => inv.id === 'INV-000144', year: 2026, month: 2, day: 10, label: 'INV-000144 Lubaina → Feb 10' },
  ];

  console.log('\n--- Applying fixes ---');
  for (const fix of fixes) {
    const matched = invoices.filter(fix.match);
    if (matched.length === 0) {
      console.warn(`⚠️  No match found for: ${fix.label}`);
      continue;
    }
    for (const inv of matched) {
      const newDate = setDate(inv.createdAt, fix.year, fix.month, fix.day);
      await updateDoc(doc(db, 'invoices', inv.id), { createdAt: newDate });
      console.log(`✅  ${fix.label} | ID: ${inv.id} | ${inv.customerName} | was: ${(inv.createdAt || '').slice(0,10)} → now: ${newDate.slice(0,10)}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
