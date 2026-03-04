// Backfill sourceOrderId on existing invoices and fix order grandTotals
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

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

async function main() {
  const [invoicesSnap, ordersSnap] = await Promise.all([
    getDocs(collection(db, 'invoices')),
    getDocs(collection(db, 'orders')),
  ]);

  // Map customer name → orders (for matching)
  const ordersByCustomer = {};
  for (const d of ordersSnap.docs) {
    const o = d.data();
    const name = (o.customerName || '').toLowerCase().trim();
    if (!ordersByCustomer[name]) ordersByCustomer[name] = [];
    ordersByCustomer[name].push({ id: d.id, ...o });
  }

  const batch = writeBatch(db);
  let changes = 0;

  for (const d of invoicesSnap.docs) {
    const inv = d.data();
    if (inv.sourceOrderId) continue; // already set

    // Match to a Completed order by customer name
    const name = (inv.customerName || '').toLowerCase().trim();
    const matchingOrders = (ordersByCustomer[name] || []).filter(o => o.status === 'Completed');

    if (matchingOrders.length === 1) {
      const order = matchingOrders[0];
      console.log(`${d.id} (${inv.customerName}) → ${order.id} | inv.balanceDue:${inv.balanceDue}`);

      // Set sourceOrderId on invoice
      batch.update(doc(db, 'invoices', d.id), { sourceOrderId: order.id });

      // Fix order grandTotal to match current invoice balanceDue
      batch.update(doc(db, 'orders', order.id), {
        grandTotal: Math.max(0, inv.balanceDue ?? 0),
      });
      changes++;
    } else if (matchingOrders.length > 1) {
      console.log(`⚠️  ${d.id} (${inv.customerName}) — multiple completed orders, skipping`);
    }
  }

  if (changes > 0) {
    await batch.commit();
    console.log(`\n✅ Backfilled ${changes} invoice(s) with sourceOrderId and synced order grandTotals.`);
  } else {
    console.log('\nNothing to backfill.');
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
