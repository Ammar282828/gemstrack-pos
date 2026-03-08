/**
 * Dry-run: lists all karigars and finds unlinked expenses matching each name.
 * Run with: node scripts/preview-karigar-links.mjs
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
});
const db = getFirestore(app);

const karigarsSnap = await getDocs(collection(db, 'karigars'));
const karigars = karigarsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

const expensesSnap = await getDocs(collection(db, 'expenses'));
const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

console.log('\n=== ALL KARIGARS ===');
for (const k of karigars) console.log(`  [${k.id}] ${k.name}`);

const searchTerms = ['manif', 'haroon', 'cw', 'raees', 'faizan'];

console.log('\n=== UNLINKED EXPENSES MATCHING SEARCH TERMS ===');
for (const term of searchTerms) {
  const matches = expenses.filter(e => {
    const desc = (e.description || '').toLowerCase();
    return desc.includes(term) && !e.karigarId;
  });
  console.log(`\n"${term}" (${matches.length} unlinked):`);
  for (const e of matches) {
    console.log(`  [${e.date?.slice(0,10)}] ${e.description} — PKR ${e.amount?.toLocaleString()}`);
  }
}

process.exit(0);
