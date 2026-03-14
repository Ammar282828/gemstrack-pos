/**
 * fix-zahra-invoice.mjs
 *
 * 1. Reads the Zahra Bombay invoice from Taheri's Firestore (gemstrack-pos)
 * 2. Gets the current lastInvoiceNumber from HoM's Firestore
 * 3. Writes the invoice to HoM's Firestore with the correct next number
 * 4. Updates HoM's lastInvoiceNumber counter
 * 5. Deletes the invoice from Taheri's Firestore
 *
 * Run ONLY while firestore.rules on both projects are open (allow read, write: if true).
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, orderBy, limit } from 'firebase/firestore';

// ── Taheri (gold) Firebase ──────────────────────────────────────────────────
const taheriConfig = {
  apiKey:            'AIzaSyAl3W_9_Z9j0sR7rGIwwM1uiiXvOxGQ7IA',
  authDomain:        'gemstrack-pos.firebaseapp.com',
  projectId:         'gemstrack-pos',
  storageBucket:     'gemstrack-pos.firebasestorage.app',
  messagingSenderId: '948018742883',
  appId:             '1:948018742883:web:a3a090dde378be96089a56',
};

// ── House of Mina (silver) Firebase ────────────────────────────────────────
const homConfig = {
  apiKey:            'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  authDomain:        'hom-pos-52710474-ceeea.firebaseapp.com',
  projectId:         'hom-pos-52710474-ceeea',
  storageBucket:     'hom-pos-52710474-ceeea.firebasestorage.app',
  messagingSenderId: '288366939838',
  appId:             '1:288366939838:web:044c8eec0a5610688798ef',
};

const taheriApp = initializeApp(taheriConfig, 'taheri');
const homApp    = initializeApp(homConfig,    'hom');

const taheriDb = getFirestore(taheriApp);
const homDb    = getFirestore(homApp);

async function main() {
  // ── 1. Find Zahra Bombay invoice(s) in Taheri DB ──────────────────────────
  console.log('\n[1] Searching Taheri DB for Zahra Bombay invoices...');

  const invRef = collection(taheriDb, 'invoices');
  const snap = await getDocs(invRef);

  const zahraInvoices = [];
  snap.forEach(d => {
    const data = d.data();
    const name = (data.customerName || '').toLowerCase();
    if (name.includes('zahra') || name.includes('bombay')) {
      zahraInvoices.push({ id: d.id, ...data });
    }
  });

  if (zahraInvoices.length === 0) {
    // Fallback: show all invoices so we can identify the right one
    console.log('No invoice found with "zahra" or "bombay" in customerName. All Taheri invoices:');
    snap.forEach(d => {
      const data = d.data();
      console.log(`  ${d.id} — ${data.customerName || '(no customer)'} — PKR ${data.grandTotal}`);
    });
    console.log('\nUpdate the script with the correct invoice ID and re-run.');
    process.exit(1);
  }

  console.log(`Found ${zahraInvoices.length} invoice(s):`);
  zahraInvoices.forEach(inv => {
    console.log(`  ${inv.id} — ${inv.customerName} — PKR ${inv.grandTotal} — items: ${JSON.stringify((inv.items || []).map(i => i.name))}`);
  });

  // If multiple, pick the first (or adjust manually)
  const sourceInvoice = zahraInvoices[0];
  const taheriInvoiceId = sourceInvoice.id;

  // ── 2. Get HoM's current lastInvoiceNumber ─────────────────────────────────
  console.log('\n[2] Reading HoM lastInvoiceNumber...');
  const counterRef = doc(homDb, 'settings', 'invoiceCounter');
  const counterSnap = await getDoc(counterRef);

  let lastNum = 0;
  if (counterSnap.exists()) {
    lastNum = counterSnap.data().lastInvoiceNumber || 0;
  }
  const nextNum = lastNum + 1;
  const newInvoiceId = `INV-${String(nextNum).padStart(6, '0')}`;
  console.log(`  Current lastInvoiceNumber: ${lastNum} → new invoice: ${newInvoiceId}`);

  // ── 3. Write the invoice to HoM DB with the correct ID ────────────────────
  console.log(`\n[3] Writing ${newInvoiceId} to HoM DB...`);
  const { id: _oldId, ...invoiceData } = sourceInvoice;
  const homInvoiceRef = doc(homDb, 'invoices', newInvoiceId);
  await setDoc(homInvoiceRef, {
    ...invoiceData,
    id: newInvoiceId,
  });
  console.log(`  ✔ Invoice ${newInvoiceId} written to HoM.`);

  // ── 4. Update HoM's lastInvoiceNumber ──────────────────────────────────────
  console.log('\n[4] Updating HoM lastInvoiceNumber...');
  await setDoc(counterRef, { lastInvoiceNumber: nextNum }, { merge: true });
  console.log(`  ✔ lastInvoiceNumber updated to ${nextNum}.`);

  // ── 5. Delete the invoice from Taheri DB ──────────────────────────────────
  console.log(`\n[5] Deleting ${taheriInvoiceId} from Taheri DB...`);
  await deleteDoc(doc(taheriDb, 'invoices', taheriInvoiceId));
  console.log(`  ✔ ${taheriInvoiceId} deleted from Taheri.`);

  // Also clean up if Taheri's lastInvoiceNumber was incremented
  const taheriCounterRef = doc(taheriDb, 'settings', 'invoiceCounter');
  const taheriCounter = await getDoc(taheriCounterRef);
  if (taheriCounter.exists()) {
    const tNum = taheriCounter.data().lastInvoiceNumber;
    if (tNum > 0) {
      await setDoc(taheriCounterRef, { lastInvoiceNumber: 0 }, { merge: true });
      console.log(`  ✔ Taheri lastInvoiceNumber reset from ${tNum} to 0.`);
    }
  }

  console.log(`\n✅ Done! Invoice moved to HoM as ${newInvoiceId}.`);
}

main().catch(console.error);
