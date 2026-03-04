// Restore overwritten orders and renumber cleanly
// Final state:
//   ORD-000001 → Hayat Junejo, 77,220 (restored from log)
//   ORD-000002 → Manahil Hussain, 350,000 (restored from log)
//   ORD-000003 → Zain Riaz, 11,940 (restored from log)
//   ORD-000004 → Mansoor Ajmerwala, 87,500 (was ORD-000001, moved)
//   ORD-000005 → Amna Allahwala, 50,050 (was ORD-000002, moved)
//   lastOrderNumber → 5

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy, doc, getDoc, setDoc, deleteDoc, writeBatch, updateDoc } from 'firebase/firestore';

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

// Find customer ID by name
async function findCustomerId(name) {
  const snap = await getDocs(collection(db, 'customers'));
  for (const d of snap.docs) {
    if (d.data().name === name) return { id: d.id, ...d.data() };
  }
  return null;
}

async function main() {
  const now = new Date().toISOString();

  // --- Step 1: Read current orders ---
  const mansoorDoc = await getDoc(doc(db, 'orders', 'ORD-000001'));
  const amnaDoc = await getDoc(doc(db, 'orders', 'ORD-000002'));

  if (!mansoorDoc.exists() || !amnaDoc.exists()) {
    console.error('Expected ORD-000001 and ORD-000002 to exist. Aborting.');
    process.exit(1);
  }

  const mansoorData = { ...mansoorDoc.data(), id: 'ORD-000004' };
  const amnaData = { ...amnaDoc.data(), id: 'ORD-000005' };

  console.log('Current ORD-000001:', mansoorDoc.data().customerName, mansoorDoc.data().grandTotal);
  console.log('Current ORD-000002:', amnaDoc.data().customerName, amnaDoc.data().grandTotal);

  // --- Step 2: Find customers ---
  const hayat = await findCustomerId('Hayat Junejo');
  const manahil = await findCustomerId('Manahil Hussain');
  const zain = await findCustomerId('Zain Riaz');

  console.log('\nCustomer lookups:');
  console.log('Hayat Junejo:', hayat ? hayat.id : 'NOT FOUND');
  console.log('Manahil Hussain:', manahil ? manahil.id : 'NOT FOUND');
  console.log('Zain Riaz:', zain ? zain.id : 'NOT FOUND');

  // --- Step 3: Build restored order stubs ---
  const restored = [
    {
      id: 'ORD-000001',
      customerId: hayat?.id || '',
      customerName: 'Hayat Junejo',
      grandTotal: 77220,
      subtotal: 77220,
      items: [],
      status: 'Pending',
      notes: '[RESTORED FROM ACTIVITY LOG — original order was overwritten. Items unknown. Please fill in manually.]',
      createdAt: '2026-03-03T08:17:48.204Z',
      ratesApplied: {},
      summary: 'Restored from activity log',
    },
    {
      id: 'ORD-000002',
      customerId: manahil?.id || '',
      customerName: 'Manahil Hussain',
      grandTotal: 350000,
      subtotal: 350000,
      items: [],
      status: 'Pending',
      notes: '[RESTORED FROM ACTIVITY LOG — original order was overwritten. Items unknown. Please fill in manually.]',
      createdAt: '2026-03-03T08:21:51.415Z',
      ratesApplied: {},
      summary: 'Restored from activity log',
    },
    {
      id: 'ORD-000003',
      customerId: zain?.id || '',
      customerName: 'Zain Riaz',
      grandTotal: 11940,
      subtotal: 11940,
      items: [],
      status: 'Pending',
      notes: '[RESTORED FROM ACTIVITY LOG — original order was overwritten. Items unknown. Please fill in manually.]',
      createdAt: '2026-03-03T08:25:43.670Z',
      ratesApplied: {},
      summary: 'Restored from activity log',
    },
  ];

  // --- Step 4: Write everything in a batch ---
  console.log('\nWriting batch...');
  const batch = writeBatch(db);

  // Move Mansoor → ORD-000004
  batch.set(doc(db, 'orders', 'ORD-000004'), mansoorData);
  // Move Amna → ORD-000005
  batch.set(doc(db, 'orders', 'ORD-000005'), amnaData);
  // Delete old ORD-000001 and ORD-000002 (will be replaced by restored ones below)
  batch.delete(doc(db, 'orders', 'ORD-000001'));
  batch.delete(doc(db, 'orders', 'ORD-000002'));

  // Write restored orders
  for (const order of restored) {
    batch.set(doc(db, 'orders', order.id), order);
  }

  // Update lastOrderNumber to 5
  batch.update(doc(db, 'app_settings', 'global'), { lastOrderNumber: 5 });

  await batch.commit();
  console.log('✅ Batch committed successfully.\n');

  console.log('Final order state:');
  console.log('  ORD-000001 → Hayat Junejo, 77,220 [RESTORED]');
  console.log('  ORD-000002 → Manahil Hussain, 350,000 [RESTORED]');
  console.log('  ORD-000003 → Zain Riaz, 11,940 [RESTORED]');
  console.log('  ORD-000004 → Mansoor Ajmerwala, 87,500 [moved from ORD-000001]');
  console.log('  ORD-000005 → Amna Allahwala, 50,050 [moved from ORD-000002]');
  console.log('  lastOrderNumber → 5');
  console.log('\nNOTE: Restored orders have empty items — you will need to fill them in manually.');

  process.exit(0);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
