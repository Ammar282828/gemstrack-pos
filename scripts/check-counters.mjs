import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs, updateDoc } from 'firebase/firestore';

const homApp = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  projectId: 'hom-pos-52710474-ceeea',
  appId: '1:288366939838:web:044c8eec0a5610688798ef'
}, 'hom');
const homDb = getFirestore(homApp);

const taheriApp = initializeApp({
  apiKey: 'AIzaSyAl3W_9_Z9j0sR7rGIwwM1uiiXvOxGQ7IA',
  projectId: 'gemstrack-pos',
  appId: '1:948018742883:web:a3a090dde378be96089a56'
}, 'taheri');
const taheriDb = getFirestore(taheriApp);

const [homSnap, taheriSnap, homOrders, homInvoices, taheriOrders, taheriInvoices] = await Promise.all([
  getDoc(doc(homDb, 'app_settings', 'global')),
  getDoc(doc(taheriDb, 'app_settings', 'global')),
  getDocs(collection(homDb, 'orders')),
  getDocs(collection(homDb, 'invoices')),
  getDocs(collection(taheriDb, 'orders')),
  getDocs(collection(taheriDb, 'invoices')),
]);

function maxNum(docs, prefix) {
  return Math.max(0, ...docs.map(d => {
    const m = d.id.match(new RegExp(prefix + '-(\\d+)'));
    return m ? parseInt(m[1], 10) : 0;
  }));
}

const maxHomOrder = maxNum(homOrders.docs, 'ORD');
const maxHomInv = maxNum(homInvoices.docs, 'INV');
const maxTaheriOrder = maxNum(taheriOrders.docs, 'ORD');
const maxTaheriInv = maxNum(taheriInvoices.docs, 'INV');

const h = homSnap.data();
const t = taheriSnap.data();

console.log('=== HoM (Silver) ===');
console.log('lastOrderNumber  :', h.lastOrderNumber, '| max actual ORD:', maxHomOrder, h.lastOrderNumber === maxHomOrder ? 'OK' : 'MISMATCH');
console.log('lastInvoiceNumber:', h.lastInvoiceNumber, '| max actual INV:', maxHomInv, h.lastInvoiceNumber === maxHomInv ? 'OK' : 'MISMATCH');

console.log('\n=== Taheri (Gold) ===');
console.log('lastOrderNumber  :', t.lastOrderNumber, '| max actual ORD:', maxTaheriOrder, t.lastOrderNumber === maxTaheriOrder ? 'OK' : 'MISMATCH');
console.log('lastInvoiceNumber:', t.lastInvoiceNumber, '| max actual INV:', maxTaheriInv, t.lastInvoiceNumber === maxTaheriInv ? 'OK' : 'MISMATCH');

// Auto-fix any mismatches
const fixes = [];
if (h.lastOrderNumber !== maxHomOrder && maxHomOrder > 0) {
  fixes.push(updateDoc(doc(homDb, 'app_settings', 'global'), { lastOrderNumber: maxHomOrder }).then(() => console.log('\n[FIX] HoM lastOrderNumber set to', maxHomOrder)));
}
if (h.lastInvoiceNumber !== maxHomInv && maxHomInv > 0) {
  fixes.push(updateDoc(doc(homDb, 'app_settings', 'global'), { lastInvoiceNumber: maxHomInv }).then(() => console.log('[FIX] HoM lastInvoiceNumber set to', maxHomInv)));
}
if (t.lastOrderNumber !== maxTaheriOrder && maxTaheriOrder > 0) {
  fixes.push(updateDoc(doc(taheriDb, 'app_settings', 'global'), { lastOrderNumber: maxTaheriOrder }).then(() => console.log('[FIX] Taheri lastOrderNumber set to', maxTaheriOrder)));
}
if (t.lastInvoiceNumber !== maxTaheriInv && maxTaheriInv > 0) {
  fixes.push(updateDoc(doc(taheriDb, 'app_settings', 'global'), { lastInvoiceNumber: maxTaheriInv }).then(() => console.log('[FIX] Taheri lastInvoiceNumber set to', maxTaheriInv)));
}

if (fixes.length) {
  await Promise.all(fixes);
  console.log('\nAll fixes applied.');
} else {
  console.log('\nNo fixes needed - all counters match.');
}

process.exit(0);
