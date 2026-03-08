/**
 * Creates karigar records for new karigars and links their matching expenses.
 * Also fixes Manif misspellings and links all pre-launch jewelry to Abdullah.
 *
 * Run: node scripts/link-new-karigars.mjs
 * Dry-run: DRY_RUN=1 node scripts/link-new-karigars.mjs
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

// Description terms that are NOT jewelry/karigar (exclude from pre-launch Abdullah sweep)
const PRE_LAUNCH_EXCLUSIONS = [
  'grace 152',       // GRACE 152g — silver stock, not a karigar job
  'domain',
  'godaddy',
  'shopify',
  'shoot expenses',
  'shoot dinner',
  'cortado rent',
  'panaflex',
  'boxes and pouch',
  'lights (shoot)',
];

// New karigars to create + their expense matching rules
// term: description must include this (case-insensitive)
// excludeTerm: skip if description also includes this (case-insensitive)
const karigarDefs = [
  { name: 'Abdullah',      term: 'abdullah' },
  { name: 'Naeem',         term: 'naeem' },
  { name: 'Kashif',        term: 'kashif' },
  { name: 'Abdul Ali',     term: 'abdul ali' },
  { name: 'Omair',         term: 'omair' },
  { name: 'Areeb',         term: 'areeb' },
  { name: 'Furqan Stones', term: 'furqan' },
  { name: 'Ismail',        term: 'engraving', excludeTerm: 'uzair' },
  { name: 'Abdul RP',      term: 'abdul rp' },
  { name: 'Yousuf RP',     term: 'yousuf rp' },
];

// Load existing karigars + expenses
const karigarsSnap = await getDocs(collection(db, 'karigars'));
const karigars = karigarsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

const expensesSnap = await getDocs(collection(db, 'expenses'));
const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

// Helper: resolve or create a karigar by name
async function resolveKarigar(name) {
  const existing = karigars.find(k => k.name?.toLowerCase() === name.toLowerCase());
  if (existing) {
    console.log(`ℹ️  Existing karigar: "${existing.name}" (${existing.id})`);
    return existing;
  }
  const id = `karigar-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const karigar = { id, name };
  if (!DRY_RUN) {
    await setDoc(doc(db, 'karigars', id), { name });
    console.log(`✅ Created karigar: "${name}" (${id})`);
  } else {
    console.log(`🆕 Would create karigar: "${name}" (${id})`);
  }
  karigars.push(karigar);
  return karigar;
}

// Helper: batch-update expenses with a karigarId
async function linkExpenses(karigar, toLink) {
  if (toLink.length === 0) {
    console.log(`   └─ No unlinked expenses found.\n`);
    return;
  }
  console.log(`   └─ ${toLink.length} expense(s) to link:`);
  for (const e of toLink) {
    console.log(`      [${(e.date || '').slice(0, 10)}] ${e.description} — PKR ${e.amount?.toLocaleString()}`);
    e.karigarId = karigar.id; // mark locally so it's not double-linked
  }
  if (DRY_RUN) { console.log(); return; }

  // Firestore batch limit is 500
  for (let i = 0; i < toLink.length; i += 400) {
    const chunk = toLink.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(e => batch.update(doc(db, 'expenses', e.id), { karigarId: karigar.id }));
    await batch.commit();
  }
  console.log();
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Standard karigar → expense linking by description term
// ──────────────────────────────────────────────────────────────────────────────
for (const def of karigarDefs) {
  console.log(`\n── ${def.name} ──`);
  const karigar = await resolveKarigar(def.name);

  const toLink = expenses.filter(e => {
    if (e.karigarId) return false;
    const desc = (e.description || '').toLowerCase();
    if (!desc.includes(def.term)) return false;
    if (def.excludeTerm && desc.includes(def.excludeTerm)) return false;
    return true;
  });

  await linkExpenses(karigar, toLink);
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. Fix Manif misspellings (manief, manif etc.) → link to existing Manif karigar
// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n── Manif (fix misspellings) ──`);
const manif = karigars.find(k => k.name?.toLowerCase() === 'manif');
if (!manif) {
  console.log('⚠️  Manif karigar not found — skipping misspelling fix.');
} else {
  console.log(`ℹ️  Found Manif karigar: ${manif.id}`);
  const manifMisspellings = expenses.filter(e => {
    if (e.karigarId) return false;
    const desc = (e.description || '').toLowerCase();
    return desc.includes('manief') || desc.includes('maneef') || desc.includes('manef');
  });
  await linkExpenses(manif, manifMisspellings);
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Pre-launch jewelry → Abdullah
//    All 2024-12-01 expenses that look like jewelry/karigar work, not excluded.
// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n── Pre-Launch jewelry → Abdullah ──`);
const abdullah = karigars.find(k => k.name?.toLowerCase() === 'abdullah');
if (!abdullah) {
  console.log('⚠️  Abdullah karigar not found (should have been created above).');
} else {
  const prelaunchJewelry = expenses.filter(e => {
    if (e.karigarId) return false;
    // Only pre-launch entries
    if (!(e.date || '').startsWith('2024-12-')) return false;
    const desc = (e.description || '').toLowerCase();
    // Skip excluded non-karigar expenses
    if (PRE_LAUNCH_EXCLUSIONS.some(ex => desc.includes(ex))) return false;
    return true;
  });
  await linkExpenses(abdullah, prelaunchJewelry);
}

console.log('\n✅ All done.');
process.exit(0);
