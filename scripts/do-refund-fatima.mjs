/**
 * do-refund-fatima.mjs
 *
 * Processes refund for INV-000145 (Fatima Mufaddal, Bracelet BRC-000012, PKR 33000).
 *
 * Mirrors what deleteInvoice(id, false) does in the app:
 *  1. Reads invoice items
 *  2. Moves each non-ORD item from soldProducts → products (stock restored)
 *  3. Deletes any hisaab entries linked to this invoice
 *  4. Marks invoice status as 'Refunded' (keeps record) and sets balanceDue = grandTotal (so it shows as unpaid/refunded)
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, deleteDoc,
  writeBatch, collection, query, where
} from 'firebase/firestore';

const homApp = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  authDomain: 'hom-pos-52710474-ceeea.firebaseapp.com',
  projectId: 'hom-pos-52710474-ceeea',
  storageBucket: 'hom-pos-52710474-ceeea.firebasestorage.app',
  messagingSenderId: '288366939838',
  appId: '1:288366939838:web:044c8eec0a5610688798ef',
}, 'hom');

const db = getFirestore(homApp);

const INVOICE_ID = 'INV-000145';

function cleanObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

async function main() {
  // 1. Read invoice
  console.log(`[1] Reading ${INVOICE_ID}...`);
  const invoiceSnap = await getDoc(doc(db, 'invoices', INVOICE_ID));
  if (!invoiceSnap.exists()) {
    console.error(`Invoice ${INVOICE_ID} not found.`);
    process.exit(1);
  }
  const invoice = invoiceSnap.data();
  console.log(`    Customer: ${invoice.customerName}, PKR ${invoice.grandTotal}`);
  console.log(`    Items: ${(invoice.items || []).map(i => `${i.name} (${i.sku})`).join(', ')}`);

  const batch = writeBatch(db);

  // 2. Restore stock: move each item from soldProducts → products
  console.log(`\n[2] Restoring stock...`);
  for (const item of invoice.items || []) {
    if (item.sku.startsWith('ORD-')) {
      console.log(`    Skipping ORD item: ${item.sku}`);
      continue;
    }

    // Read original soldProduct record (may have more fields)
    const soldSnap = await getDoc(doc(db, 'soldProducts', item.sku));
    
    const productData = cleanObject({
      sku: item.sku,
      name: item.name,
      categoryId: item.categoryId,
      metalType: item.metalType,
      karat: item.karat,
      metalWeightG: item.metalWeightG,
      hasStones: (item.stoneChargesIfAny || 0) > 0,
      stoneWeightG: item.stoneWeightG,
      wastagePercentage: item.wastagePercentage,
      makingCharges: item.makingCharges,
      hasDiamonds: (item.diamondChargesIfAny || 0) > 0,
      diamondCharges: item.diamondChargesIfAny,
      stoneCharges: item.stoneChargesIfAny,
      miscCharges: item.miscChargesIfAny,
      stoneDetails: item.stoneDetails,
      diamondDetails: item.diamondDetails,
      ...(item.isCustomPrice ? { isCustomPrice: true, customPrice: item.unitPrice } : {}),
    });

    if (soldSnap.exists()) {
      const existing = soldSnap.data();
      // Merge in any extra fields from the soldProduct doc (images, notes, etc.)
      Object.keys(existing).forEach(k => {
        if (!(k in productData)) productData[k] = existing[k];
      });
    }

    batch.set(doc(db, 'products', item.sku), productData);
    batch.delete(doc(db, 'soldProducts', item.sku));
    console.log(`    ✔ ${item.sku} (${item.name}) → products`);
  }

  // 3. Delete linked hisaab entries
  console.log(`\n[3] Checking linked hisaab entries...`);
  const hisaabSnap = await getDocs(
    query(collection(db, 'hisaab'), where('linkedInvoiceId', '==', INVOICE_ID))
  );
  hisaabSnap.docs.forEach(d => {
    console.log(`    Deleting hisaab entry: ${d.id}`);
    batch.delete(d.ref);
  });
  if (hisaabSnap.empty) console.log('    (none)');

  // 4. Mark invoice as Refunded (keeps record for accounting)
  console.log(`\n[4] Marking invoice as Refunded...`);
  batch.set(doc(db, 'invoices', INVOICE_ID), {
    ...invoice,
    status: 'Refunded',
    amountPaid: 0,
    balanceDue: invoice.grandTotal,
    refundedAt: new Date().toISOString(),
  });

  await batch.commit();
  console.log(`\n✅ Done! INV-000145 refunded. BRC-000012 restored to inventory.`);
}

main().catch(console.error);
