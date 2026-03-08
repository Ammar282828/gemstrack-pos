/**
 * Creates missing karigar records and links matching expenses to them.
 * Handles: Manif, Haroon, CW, Raees, Faizan
 *
 * Run with: node scripts/link-all-karigar-expenses.mjs
 * Dry-run:  DRY_RUN=1 node scripts/link-all-karigar-expenses.mjs
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, writeBatch } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
});
const db = getFirestore(app);

const DRY_RUN = process.env.DRY_RUN === '1';

// Karigars to ensure exist + their expense description search term
// term: matches if description.toLowerCase().includes(term)
const karigarDefs = [
  { name: 'Manif',  term: 'manif' },
  { name: 'Haroon', term: 'haroon' },
  { name: 'CW',     term: 'cw' },
  { name: 'Raees',  term: 'raees' },
  { name: 'Faizan', term: 'faizan' },
];

// 1. Load existing karigars
const karigarsSnap = await getDocs(collection(db, 'karigars'));
const karigars = karigarsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

// 2. Load all expenses
const expensesSnap = await getDocs(collection(db, 'expenses'));
const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

// 3. Resolve or create each karigar, then find matching expenses
for (const def of karigarDefs) {
  const existing = karigars.find(k => k.name?.toLowerCase() === def.name.toLowerCase());
  let karigar = existing;

  if (!karigar) {
    const id = `karigar-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    karigar = { id, name: def.name };
    if (!DRY_RUN) {
      await setDoc(doc(db, 'karigars', id), karigar);
      console.log(`✅ Created karigar: "${def.name}" (ID: ${id})`);
    } else {
      console.log(`🆕 Would create karigar: "${def.name}" (ID: ${id})`);
    }
    // Add to local list so subsequent passes can reference it
    karigars.push(karigar);
  } else {
    console.log(`ℹ️  Found existing karigar: "${karigar.name}" (ID: ${karigar.id})`);
  }

  // Find unlinked expenses matching this term
  const toLink = expenses.filter(e => {
    const desc = (e.description || '').toLowerCase();
    return desc.includes(def.term) && !e.karigarId;
  });

  if (toLink.length === 0) {
    console.log(`   └─ No unlinked expenses found for "${def.name}"\n`);
    continue;
  }

  console.log(`   └─ ${toLink.length} expense(s) to link:`);
  for (const e of toLink) {
    console.log(`      [${e.date?.slice(0, 10)}] ${e.description} — PKR ${e.amount?.toLocaleString()}`);
    e.karigarId = karigar.id; // mark locally to avoid double-matching
  }

  if (!DRY_RUN) {
    let batch = writeBatch(db);
    let count = 0;
    for (const e of toLink) {
      batch.update(doc(db, 'expenses', e.id), { karigarId: karigar.id });
      count++;
      if (count >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
    console.log(`   ✅ Linked ${toLink.length} expense(s) to "${karigar.name}"\n`);
  } else {
    console.log(`   🔍 DRY RUN — no writes performed\n`);
  }
}

if (DRY_RUN) console.log('🔍 DRY RUN complete. Remove DRY_RUN=1 to apply changes.');
else console.log('🎉 All done.');
process.exit(0);
