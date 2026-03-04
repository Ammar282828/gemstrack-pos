import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, doc, getDoc, writeBatch, deleteDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
  storageBucket: "hom-pos-52710474-ceeea.firebasestorage.app",
  messagingSenderId: "288366939838",
  appId: "1:288366939838:web:044c8eec0a5610688798ef"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TO_DELETE = ['INV-000008', 'INV-000009', 'INV-000010', 'INV-000011'];

async function main() {
  // Fetch invoices
  const invoices = {};
  for (const id of TO_DELETE) {
    const snap = await getDoc(doc(db, 'invoices', id));
    if (snap.exists()) invoices[id] = snap.data();
    else console.log(`${id} not found, skipping`);
  }

  // Collect all SKUs that need to be restored from sold_products → products
  // Only restore if the SKU isn't also in a KEPT invoice (003-007)
  const keptInvoiceIds = ['INV-000003','INV-000004','INV-000005','INV-000006','INV-000007'];
  const skusInKeptInvoices = new Set();
  for (const id of keptInvoiceIds) {
    const snap = await getDoc(doc(db, 'invoices', id));
    if (snap.exists()) {
      for (const item of (snap.data().items || [])) {
        if (item.sku) skusInKeptInvoices.add(item.sku);
      }
    }
  }

  console.log('SKUs in kept invoices (will NOT restore these):', [...skusInKeptInvoices]);

  // Find SKUs to restore
  const skusToRestore = [];
  for (const [id, inv] of Object.entries(invoices)) {
    console.log(`\n${id}: ${inv.customerName}, Total: ${inv.grandTotal}`);
    for (const item of (inv.items || [])) {
      console.log(`  - SKU: ${item.sku}, ${item.name}, ${item.price}`);
      if (item.sku && !skusInKeptInvoices.has(item.sku)) {
        skusToRestore.push({ sku: item.sku, item });
      } else if (item.sku) {
        console.log(`    → SKU ${item.sku} is in a kept invoice, skipping restore`);
      }
    }
  }

  console.log(`\nSKUs to restore to active inventory: ${skusToRestore.map(s => s.sku).join(', ') || 'none'}`);

  // Fetch hisaab entries for these invoices
  const hisaabToDelete = [];
  const hisaabSnap = await getDocs(collection(db, 'hisaab'));
  for (const d of hisaabSnap.docs) {
    const entry = d.data();
    if (TO_DELETE.some(id => entry.description?.includes(id))) {
      hisaabToDelete.push(d.id);
      console.log(`Hisaab to delete: ${d.id} — ${entry.description}`);
    }
  }

  // Execute batch deletions
  const batch = writeBatch(db);

  // Delete invoices
  for (const id of TO_DELETE) {
    if (invoices[id]) batch.delete(doc(db, 'invoices', id));
  }

  // Delete hisaab entries
  for (const id of hisaabToDelete) {
    batch.delete(doc(db, 'hisaab', id));
  }

  // Restore sold products → active products
  for (const { sku, item } of skusToRestore) {
    const soldSnap = await getDoc(doc(db, 'sold_products', sku));
    if (soldSnap.exists()) {
      const productData = { ...soldSnap.data(), status: 'active' };
      delete productData.soldAt;
      delete productData.invoiceId;
      batch.set(doc(db, 'products', sku), productData);
      batch.delete(doc(db, 'sold_products', sku));
      console.log(`Restoring SKU ${sku} to active inventory`);
    } else {
      console.log(`SKU ${sku} not found in sold_products, skipping`);
    }
  }

  // Update lastInvoiceNumber to 7
  batch.update(doc(db, 'app_settings', 'global'), { lastInvoiceNumber: 7 });

  await batch.commit();
  console.log('\n✅ Done. Deleted INV-000008 through INV-000011, lastInvoiceNumber reset to 7.');
  process.exit(0);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
