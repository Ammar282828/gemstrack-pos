/**
 * fix-counter-and-overwritten.mjs
 *
 * Problem: renumber-zahra.mjs wrote the counter to settings/invoiceCounter
 * but the app reads settings/global. So new invoices started from 1 again,
 * overwriting existing ones (INV-000001, INV-000002, etc.).
 *
 * This script:
 *  1. Dumps all current HoM invoices sorted by ID (to see what's there)
 *  2. Reads settings/global to see the current counter
 *  3. Shows what's in overwritten slots vs. original Shopify data
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

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
  // Check the real counter doc
  const globalSnap = await getDoc(doc(db, 'settings', 'global'));
  console.log('\n=== settings/global ===');
  if (globalSnap.exists()) {
    const d = globalSnap.data();
    console.log('  lastInvoiceNumber:', d.lastInvoiceNumber);
  } else {
    console.log('  (doc does not exist!)');
  }

  const wrongSnap = await getDoc(doc(db, 'settings', 'invoiceCounter'));
  console.log('\n=== settings/invoiceCounter (wrong doc, written by mistake) ===');
  if (wrongSnap.exists()) {
    console.log('  ', JSON.stringify(wrongSnap.data()));
  } else {
    console.log('  (does not exist)');
  }

  // List all invoices
  const snap = await getDocs(collection(db, 'invoices'));
  const all = [];
  snap.forEach(d => all.push({ id: d.id, ...d.data() }));
  all.sort((a, b) => a.id.localeCompare(b.id));

  console.log(`\n=== All HoM Invoices (${all.length} total) ===`);
  all.forEach(inv => {
    const date = (inv.createdAt || inv.date || '').slice(0, 10);
    console.log(`  ${inv.id}  ${date}  ${(inv.customerName || '').padEnd(25)}  PKR ${inv.grandTotal}  ${inv.source || ''}`);
  });
}

main().catch(console.error);
