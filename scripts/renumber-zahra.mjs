/**
 * renumber-zahra.mjs
 *
 * INV-000001 (Zahra Bombay, PKR 8500) was created on 2026-03-09 AFTER the
 * Shopify import. Because the settings/invoiceCounter doc didn't exist, the
 * app defaulted to starting from 0 → INV-000001 (wrong).
 *
 * This script:
 *  1. Copies INV-000001 to INV-000154 in HoM's Firestore
 *  2. Creates/updates settings/invoiceCounter with lastInvoiceNumber: 154
 *  3. Deletes the old INV-000001
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const homApp = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  authDomain: 'hom-pos-52710474-ceeea.firebaseapp.com',
  projectId: 'hom-pos-52710474-ceeea',
  storageBucket: 'hom-pos-52710474-ceeea.firebasestorage.app',
  messagingSenderId: '288366939838',
  appId: '1:288366939838:web:044c8eec0a5610688798ef',
}, 'hom');

const db = getFirestore(homApp);

const OLD_ID = 'INV-000001';
const NEW_ID = 'INV-000154';
const NEW_NUM = 154;

async function main() {
  // 1. Read the old invoice
  console.log(`[1] Reading ${OLD_ID}...`);
  const oldSnap = await getDoc(doc(db, 'invoices', OLD_ID));
  if (!oldSnap.exists()) {
    console.error(`${OLD_ID} not found — nothing to do.`);
    process.exit(1);
  }
  const data = oldSnap.data();
  console.log(`    Customer: ${data.customerName}, PKR ${data.grandTotal}, Date: ${data.date}`);

  // 2. Write as INV-000154
  console.log(`[2] Creating ${NEW_ID}...`);
  await setDoc(doc(db, 'invoices', NEW_ID), {
    ...data,
    id: NEW_ID,
  });
  console.log(`    ✔ ${NEW_ID} written.`);

  // 3. Set the counter
  console.log(`[3] Setting lastInvoiceNumber to ${NEW_NUM}...`);
  await setDoc(doc(db, 'settings', 'invoiceCounter'), { lastInvoiceNumber: NEW_NUM }, { merge: true });
  console.log(`    ✔ Counter set.`);

  // 4. Delete the old invoice
  console.log(`[4] Deleting ${OLD_ID}...`);
  await deleteDoc(doc(db, 'invoices', OLD_ID));
  console.log(`    ✔ ${OLD_ID} deleted.`);

  console.log(`\n✅ Done! Zahra Bombay invoice is now ${NEW_ID}. Next invoice will be INV-000155.`);
}

main().catch(console.error);
