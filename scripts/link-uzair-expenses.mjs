/**
 * Links all Uzair-related expenses to his karigar record in Firestore.
 * Matches expenses whose description contains "uzair" (case-insensitive)
 * but NOT "stone" (to skip Uzair Stones vendor entries).
 *
 * Run with: node scripts/link-uzair-expenses.mjs
 * Dry-run (preview only): DRY_RUN=1 node scripts/link-uzair-expenses.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
});
const db = getFirestore(app);

const DRY_RUN = process.env.DRY_RUN === '1';

// 1. Find Uzair's karigar record
const karigarsSnap = await getDocs(collection(db, 'karigars'));
const uzairKarigar = karigarsSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .find(k => k.name?.toLowerCase().includes('uzair'));

if (!uzairKarigar) {
  console.error('❌ Could not find a karigar named Uzair. Check the karigars collection.');
  process.exit(1);
}
console.log(`✅ Found karigar: "${uzairKarigar.name}" (ID: ${uzairKarigar.id})`);

// 2. Load all expenses and filter to Uzair-related ones (not stones)
const expensesSnap = await getDocs(collection(db, 'expenses'));
const toLink = expensesSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(e => {
    const desc = (e.description || '').toLowerCase();
    const isUzair = desc.includes('uzair');
    const isStone = desc.includes('stone');
    const alreadyLinked = !!e.karigarId;
    return isUzair && !isStone && !alreadyLinked;
  });

if (toLink.length === 0) {
  console.log('ℹ️  No matching expenses found (either all already linked, or none match "uzair" without "stone").');
  process.exit(0);
}

console.log(`\n📋 Expenses to link (${toLink.length}):`);
for (const e of toLink) {
  console.log(`  [${e.date?.slice(0, 10)}] ${e.description} — PKR ${e.amount?.toLocaleString()}`);
}

if (DRY_RUN) {
  console.log('\n🔍 DRY RUN — no changes written. Remove DRY_RUN=1 to apply.');
  process.exit(0);
}

// 3. Batch update
let batch = writeBatch(db);
let count = 0;
let total = 0;

for (const e of toLink) {
  batch.update(doc(db, 'expenses', e.id), { karigarId: uzairKarigar.id });
  count++;
  total++;
  if (count >= 400) {
    await batch.commit();
    console.log(`  Committed batch (${total} so far)...`);
    batch = writeBatch(db);
    count = 0;
  }
}
if (count > 0) await batch.commit();

console.log(`\n✅ Done — ${total} expense(s) linked to karigar "${uzairKarigar.name}".`);
process.exit(0);
