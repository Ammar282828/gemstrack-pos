import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
  authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
  projectId: "hom-pos-52710474-ceeea",
  storageBucket: "hom-pos-52710474-ceeea.firebasestorage.app",
  messagingSenderId: "288366939838",
  appId: "1:288366939838:web:044c8eec0a5610688798ef"
});
const db = getFirestore(app);

// Fixes item SKUs of the form ORD-ORD-000186-1 → ORD-000186-1
// (caused by old code that did `ORD-${order.id}-${i}` where order.id was already ORD-XXXXXX)
function fixSku(sku) {
  // ORD-ORD-000186-1 → ORD-000186-1
  return sku.replace(/^ORD-ORD-/, 'ORD-');
}

async function main() {
  const snap = await getDocs(collection(db, 'invoices'));
  let fixed = 0;
  let skipped = 0;

  for (const invDoc of snap.docs) {
    const data = invDoc.data();
    const items = Array.isArray(data.items) ? data.items : Object.values(data.items || {});

    const needsFix = items.some(item => item.sku && item.sku.startsWith('ORD-ORD-'));
    if (!needsFix) { skipped++; continue; }

    const newItems = items.map(item => ({
      ...item,
      sku: item.sku ? fixSku(item.sku) : item.sku,
    }));

    await updateDoc(doc(db, 'invoices', invDoc.id), { items: newItems });
    console.log(`✅ Fixed ${invDoc.id} — ${newItems.map(i => i.sku).join(', ')}`);
    fixed++;
  }

  console.log(`\nDone. Fixed: ${fixed}, Skipped (already correct): ${skipped}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
