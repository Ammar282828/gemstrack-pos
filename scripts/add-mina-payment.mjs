/**
 * Adds Mina's payment of PKR 403,000 (100,000+200,000+53,000+50,000) to mina_ledger.
 *
 * Run: node scripts/add-mina-payment.mjs
 * Dry-run: DRY_RUN=1 node scripts/add-mina-payment.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, Timestamp } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
});
const db = getFirestore(app);

const DRY_RUN = process.env.DRY_RUN === '1';

const payment = {
  type: 'payment',
  description: 'Payment (100,000 + 200,000 + 53,000 + 50,000)',
  amount: 403000,
  date: Timestamp.fromDate(new Date('2026-03-30')),
  createdAt: Timestamp.now(),
};

console.log('Payment to add:', JSON.stringify({ ...payment, date: payment.date.toDate().toISOString(), createdAt: payment.createdAt.toDate().toISOString() }, null, 2));

if (DRY_RUN) {
  console.log('\n🏃 DRY RUN — nothing written.');
  process.exit(0);
}

const ref = await addDoc(collection(db, 'mina_ledger'), payment);
console.log(`✅ Payment added: ${ref.id} — PKR 403,000`);
process.exit(0);
