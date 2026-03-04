import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
});
const db = getFirestore(app);

// 1. Load all Shopify invoices
const invoicesSnap = await getDocs(query(collection(db, 'invoices'), where('source', '==', 'shopify_import')));
console.log(`Found ${invoicesSnap.size} Shopify invoices.`);

// 2. Collect unique customers by normalized name
const uniqueMap = new Map(); // normalized name → { name, phone }
for (const d of invoicesSnap.docs) {
  const { customerName, customerContact } = d.data();
  if (!customerName || customerName === 'Walk-in Customer') continue;
  const key = customerName.trim().toLowerCase();
  if (!uniqueMap.has(key)) {
    uniqueMap.set(key, { name: customerName.trim(), phone: customerContact?.trim() || '' });
  }
}
console.log(`${uniqueMap.size} unique Shopify customers found.`);

// 3. Load existing customers to deduplicate
const existingSnap = await getDocs(collection(db, 'customers'));
const existingNames = new Set(existingSnap.docs.map(d => d.data().name?.trim().toLowerCase()));
console.log(`${existingNames.size} existing customers in DB.`);

// 4. Filter to only new customers
const toAdd = [...uniqueMap.values()].filter(c => !existingNames.has(c.name.toLowerCase()));
console.log(`${toAdd.length} new customers to add.`);

if (toAdd.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

// 5. Write in batches
let batch = writeBatch(db);
let count = 0;
let total = 0;

for (const customer of toAdd) {
  const id = `shopify-cust-${Date.now()}-${total}`;
  const ref = doc(db, 'customers', id);
  batch.set(ref, { id, name: customer.name, phone: customer.phone });
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
console.log(`\n✅ Added ${total} Shopify customers to the database.`);
process.exit(0);
