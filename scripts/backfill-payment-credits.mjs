/**
 * backfill-payment-credits.mjs
 *
 * Scans all invoices that have amountPaid > 0.
 * For each payment in paymentHistory, checks if a matching cashCredit hisaab entry
 * already exists. If not, creates one.
 *
 * Safe to run multiple times — skips any invoice+payment combos that are already covered.
 *
 * Run: node scripts/backfill-payment-credits.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc } from 'firebase/firestore';

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
  // Load all hisaab credit entries (cashCredit > 0, linkedInvoiceId set)
  const hisaabSnap = await getDocs(collection(db, 'hisaab'));
  const existingCredits = hisaabSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.linkedInvoiceId && e.cashCredit > 0);

  console.log(`Loaded ${hisaabSnap.docs.length} hisaab entries (${existingCredits.length} are payment credits).`);

  // Load all invoices with at least one payment
  const invoicesSnap = await getDocs(collection(db, 'invoices'));
  const paidInvoices = invoicesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(inv => inv.amountPaid > 0 && inv.customerId && inv.customerId !== 'walk-in' && Array.isArray(inv.paymentHistory) && inv.paymentHistory.length > 0);

  console.log(`Found ${paidInvoices.length} invoices with recorded payments.\n`);

  let created = 0;
  let skipped = 0;

  for (const inv of paidInvoices) {
    // Sum of existing credit entries for this invoice
    const creditsForInvoice = existingCredits.filter(e => e.linkedInvoiceId === inv.id);
    const alreadyCredited = creditsForInvoice.reduce((sum, e) => sum + (e.cashCredit || 0), 0);
    const totalPaid = inv.paymentHistory.reduce((sum, p) => sum + (p.amount || 0), 0);

    if (alreadyCredited >= totalPaid) {
      console.log(`  SKIP  ${inv.id} (${inv.customerName}) — already has ${alreadyCredited.toLocaleString()} credited`);
      skipped++;
      continue;
    }

    // Figure out which payments are missing credit entries.
    // Strategy: sort both by amount and create credits for the gap.
    // Simplest safe approach: if total credited < total paid, create one entry per
    // paymentHistory item that isn't already accounted for (matching by amount).
    const pendingPayments = [...inv.paymentHistory];

    // Remove already-covered amounts greedily
    for (const credit of creditsForInvoice) {
      const idx = pendingPayments.findIndex(p => p.amount === credit.cashCredit);
      if (idx !== -1) pendingPayments.splice(idx, 1);
    }

    for (const payment of pendingPayments) {
      const entryDate = payment.date || inv.createdAt;
      await addDoc(collection(db, 'hisaab'), {
        entityId: inv.customerId,
        entityType: 'customer',
        entityName: inv.customerName || 'Customer',
        date: entryDate,
        description: `Payment received for Invoice ${inv.id}`,
        cashDebit: 0,
        cashCredit: payment.amount,
        goldDebitGrams: 0,
        goldCreditGrams: 0,
        linkedInvoiceId: inv.id,
      });
      console.log(`  ADD   ${inv.id} (${inv.customerName}) — credited ${payment.amount.toLocaleString()} on ${entryDate}`);
      created++;
    }
  }

  console.log(`\nDone. Created ${created} credit entries, skipped ${skipped} already-covered invoices.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
