import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc, query, where, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  authDomain: 'hom-pos-52710474-ceeea.firebaseapp.com',
  projectId: 'hom-pos-52710474-ceeea',
  storageBucket: 'hom-pos-52710474-ceeea.firebasestorage.app',
  messagingSenderId: '288366939838',
  appId: '1:288366939838:web:044c8eec0a5610688798ef',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const INVOICE_ID = 'INV-000148';

async function main() {
  // List all invoices for Sherbano to diagnose
  const invSnap = await getDocs(collection(db, 'invoices'));
  console.log(`Total invoices in collection: ${invSnap.size}`);

  let invoice = null;
  invSnap.forEach(d => {
    const data = d.data();
    if ((data.customerName || '').toLowerCase().includes('sherban')) {
      console.log(`Found Sherbano invoice: ${d.id} | ${data.createdAt?.slice(0,10)} | PKR ${data.grandTotal}`);
      if (d.id === INVOICE_ID) invoice = { id: d.id, ...data };
    }
  });

  if (!invoice) {
    console.log(`\n⚠️  Invoice ${INVOICE_ID} not found — may already be deleted.`);
    // Still check orders for cleanup
    const ordersSnap = await getDocs(collection(db, 'orders'));
    ordersSnap.docs.forEach(d => {
      const data = d.data();
      if ((data.customerName || '').toLowerCase().includes('sherban')) {
        console.log(`  Order ${d.id}: status=${data.status}, invoiceId=${data.invoiceId || 'none'}`);
      }
    });
    process.exit(0);
  }

  console.log(`\n📄 Invoice: ${invoice.id}`);
  console.log(`   Customer: ${invoice.customerName}`);
  console.log(`   Source Order: ${invoice.sourceOrderId || 'N/A'}`);
  console.log(`   Date: ${invoice.createdAt?.slice(0, 10)}`);
  console.log(`   Total: PKR ${invoice.grandTotal?.toLocaleString()}`);
  console.log(`   Deleting...`);

  // Find and delete linked hisaab entries
  const hSnap = await getDocs(query(collection(db, 'hisaab'), where('linkedInvoiceId', '==', INVOICE_ID)));
  console.log(`\n🧾 Linked hisaab entries: ${hSnap.size}`);
  for (const d of hSnap.docs) {
    console.log(`   Deleting hisaab: ${d.id} — ${d.data().description}`);
    await deleteDoc(doc(db, 'hisaab', d.id));
  }

  // Delete the invoice
  await deleteDoc(doc(db, 'invoices', INVOICE_ID));
  console.log(`\n✅ Invoice ${INVOICE_ID} deleted.`);

  // If linked to an order, clear invoiceId from order
  if (invoice.sourceOrderId) {
    const orderRef = doc(db, 'orders', invoice.sourceOrderId);
    const ordersSnap = await getDocs(collection(db, 'orders'));
    const orderDoc = ordersSnap.docs.find(d => d.id === invoice.sourceOrderId);
    if (orderDoc) {
      const data = orderDoc.data();
      const updated = { ...data, status: 'In Progress' };
      delete updated.invoiceId;
      await setDoc(orderRef, updated);
      console.log(`✅ Order ${invoice.sourceOrderId} reverted to 'In Progress' and invoiceId cleared.`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
