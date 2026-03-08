/**
 * Adds two negative entries from Uzair's July/Aug 2025 hisaab as positive expenses
 * linked to his karigar record.
 *
 * Run: node scripts/add-uzair-skipped-entries.mjs
 * Dry-run: DRY_RUN=1 node scripts/add-uzair-skipped-entries.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
});
const db = getFirestore(app);

const DRY_RUN = process.env.DRY_RUN === '1';

// Find Uzair's karigar record
const karigarsSnap = await getDocs(collection(db, 'karigars'));
const uzair = karigarsSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .find(k => k.name?.toLowerCase().includes('uzair'));

if (!uzair) {
  console.error('❌ Could not find a karigar named Uzair.');
  process.exit(1);
}
console.log(`✅ Found karigar: "${uzair.name}" (${uzair.id})`);

const toAdd = [
  {
    date: '2025-07-28',
    description: 'Chandi Galai',
    amount: 74410,
    category: 'Supplies',
    karigarId: uzair.id,
  },
  {
    date: '2025-08-20',
    description: 'Uzair',
    amount: 84300,
    category: 'Supplies',
    karigarId: uzair.id,
  },
];

console.log('\nEntries to add:');
for (const e of toAdd) {
  console.log(`  [${e.date}] ${e.description} → PKR ${e.amount.toLocaleString()} (karigarId: ${e.karigarId})`);
}

if (DRY_RUN) {
  console.log('\n⚠️  DRY RUN — nothing written.');
  process.exit(0);
}

for (const e of toAdd) {
  const ref = await addDoc(collection(db, 'expenses'), e);
  console.log(`  ✅ Added: ${e.description} (${e.date}) → ${ref.id}`);
}

console.log('\n✅ Done — 2 expenses added.');
process.exit(0);
