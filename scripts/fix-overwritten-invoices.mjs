/**
 * fix-overwritten-invoices.mjs
 *
 * Problem: renumber-zahra.mjs wrote counter to settings/invoiceCounter
 * but app uses app_settings/global. So the counter in app_settings/global
 * remained at 1 (only 1 manual invoice had ever been created: Zahra Bombay).
 *
 * When new invoices were created after the renumber:
 *   - counter was 1 → next = 2 → INV-000002 was overwritten (was Usaid Hamdani)
 *
 * This script:
 *  1. Shows current state of app_settings/global
 *  2. Reads full data of overwritten INV-000002 (Samina Motiwala)
 *  3. Renumbers Samina to INV-000155
 *  4. Restores Usaid Hamdani (from CSV or Shopify import data) at INV-000002
 *  5. Sets app_settings/global.lastInvoiceNumber = 155
 *  6. Deletes the stray settings/invoiceCounter wrong doc
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

async function main() {
  // 1. Show current settings/global state
  console.log('=== app_settings/global ===');
  const globalSnap = await getDoc(doc(db, 'app_settings', 'global'));
  if (globalSnap.exists()) {
    const g = globalSnap.data();
    console.log('  lastInvoiceNumber:', g.lastInvoiceNumber);
    console.log('  (other keys):', Object.keys(g).filter(k => k !== 'lastInvoiceNumber').join(', '));
  } else {
    console.log('  (does not exist)');
  }

  // 2. Read the current INV-000002 (Samina Motiwala, the overwriting invoice)
  console.log('\n=== Current INV-000002 ===');
  const inv2Snap = await getDoc(doc(db, 'invoices', 'INV-000002'));
  if (!inv2Snap.exists()) {
    console.log('  (does not exist — nothing to renumber)');
    // Still fix the counter
  } else {
    const inv2 = inv2Snap.data();
    console.log(`  Customer: ${inv2.customerName}, PKR ${inv2.grandTotal}`);
    console.log(`  Date: ${inv2.createdAt}`);
    console.log(`  Items: ${(inv2.items || []).map(i => `${i.name} (${i.sku})`).join(', ')}`);

    // 3. Renumber Samina to INV-000155
    console.log('\n[3] Renumbering INV-000002 → INV-000155...');
    await setDoc(doc(db, 'invoices', 'INV-000155'), { ...inv2, id: 'INV-000155' });
    await deleteDoc(doc(db, 'invoices', 'INV-000002'));
    console.log('    ✔ Done. Samina Motiwala is now INV-000155.');
  }

  // 4. Restore Usaid Hamdani at INV-000002 from Shopify CSV
  console.log('\n[4] Restoring INV-000002 (Usaid Hamdani) from Shopify import data...');
  // CSV: #1002, 2024-10-05 17:27:55 +0500, "Sana - S", PKR 15000, paid, fulfilled
  const createdAt002 = new Date('2024-10-05T17:27:55+05:00').toISOString();
  const usaidHamdaniInvoice = {
    id: 'INV-000002',
    shopifyOrderName: '#1002',
    customerId: '',
    customerName: 'Usaid Hamdani',
    customerContact: '',
    items: [{
      sku: 'SHOP-1002',
      name: 'Sana - S',
      categoryId: '',
      metalType: 'gold',
      karat: '21k',
      metalWeightG: 0,
      stoneWeightG: 0,
      quantity: 1,
      unitPrice: 15000,
      itemTotal: 15000,
      metalCost: 0,
      wastageCost: 0,
      wastagePercentage: 0,
      makingCharges: 15000,
      diamondChargesIfAny: 0,
      stoneChargesIfAny: 0,
      miscChargesIfAny: 0,
    }],
    subtotal: 15000,
    discountAmount: 0,
    grandTotal: 15000,
    amountPaid: 15000,
    balanceDue: 0,
    createdAt: createdAt002,
    ratesApplied: {},
    paymentHistory: [{ amount: 15000, date: createdAt002, notes: 'Shopify payment' }],
    source: 'shopify_import',
  };
  await setDoc(doc(db, 'invoices', 'INV-000002'), usaidHamdaniInvoice);
  console.log('    ✔ INV-000002 restored as Usaid Hamdani (Sana - S, PKR 15000, shopify_import).');

  // 5. Set correct counter
  console.log('\n[5] Setting app_settings/global.lastInvoiceNumber = 155...');
  if (globalSnap.exists()) {
    await setDoc(doc(db, 'app_settings', 'global'),
      { lastInvoiceNumber: 155 },
      { merge: true }
    );
  } else {
    // doc doesn't exist — create minimal version with just the counter
    // The app will fill in other settings fields when it initializes
    await setDoc(doc(db, 'app_settings', 'global'), { lastInvoiceNumber: 155 });
  }
  console.log('    ✔ Counter set to 155.');

  // 6. Delete the stray wrong counter doc
  console.log('\n[6] Deleting wrong settings/invoiceCounter doc...');
  try {
    await deleteDoc(doc(db, 'settings', 'invoiceCounter'));
    console.log('    ✔ Deleted.');
  } catch(e) {
    console.log('    (already gone or error:', e.message, ')');
  }

  console.log('\n✅ Done. Next invoice will be INV-000156.');
}

main().catch(console.error);
