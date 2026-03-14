/**
 * refund-fatima.mjs
 *
 * Processes a refund for Fatima Mufaddal's invoice(s) in HoM.
 * - Lists her invoices / orders
 * - Shows details so we can confirm before acting
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';

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
  // Search invoices
  const invSnap = await getDocs(collection(db, 'invoices'));
  const fatimaInvoices = [];
  invSnap.forEach(d => {
    const data = d.data();
    if ((data.customerName || '').toLowerCase().includes('fatima')) {
      fatimaInvoices.push({ id: d.id, ...data });
    }
  });

  // Search orders
  const ordSnap = await getDocs(collection(db, 'orders'));
  const fatimaOrders = [];
  ordSnap.forEach(d => {
    const data = d.data();
    if ((data.customerName || '').toLowerCase().includes('fatima')) {
      fatimaOrders.push({ id: d.id, ...data });
    }
  });

  console.log('\n=== Fatima Invoices ===');
  if (fatimaInvoices.length === 0) {
    console.log('  (none)');
  } else {
    fatimaInvoices.forEach(inv => {
      console.log(`  ${inv.id} — PKR ${inv.grandTotal} — paid: PKR ${inv.amountPaid} — balance: PKR ${inv.balanceDue}`);
      console.log(`    Customer: ${inv.customerName}`);
      console.log(`    Date: ${inv.createdAt || inv.date}`);
      console.log(`    Items: ${(inv.items || []).map(i => `${i.name} (${i.sku})`).join(', ')}`);
      console.log(`    Status: ${inv.status || '(no status field)'}`);
    });
  }

  console.log('\n=== Fatima Orders ===');
  if (fatimaOrders.length === 0) {
    console.log('  (none)');
  } else {
    fatimaOrders.forEach(ord => {
      console.log(`  ${ord.id} — PKR ${ord.grandTotal} — status: ${ord.status}`);
      console.log(`    Customer: ${ord.customerName}`);
      console.log(`    invoiceId: ${ord.invoiceId || '(none)'}`);
      console.log(`    Items: ${(ord.items || []).map(i => `${i.description || i.name} (${i.sku})`).join(', ')}`);
    });
  }
}

main().catch(console.error);
