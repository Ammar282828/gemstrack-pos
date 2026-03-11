import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, writeBatch } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  projectId: 'hom-pos-52710474-ceeea',
});
const db = getFirestore(app);

const CUSTOMER_ID = 'shopify-cust-1772597672024-47';
const CUSTOMER_NAME = 'Bareeka Raza';
const INVOICE_ID = 'INV-000085';
const BALANCE = 7000;

const invDoc = await getDoc(doc(db, 'invoices', INVOICE_ID));
const inv = invDoc.data();
const createdAt = inv.createdAt || new Date().toISOString();

const batch = writeBatch(db);

// Fix the invoice's customerId and customerName
batch.update(doc(db, 'invoices', INVOICE_ID), {
  customerId: CUSTOMER_ID,
  customerName: CUSTOMER_NAME,
});

// Create the hisaab entry
const hisaabRef = doc(collection(db, 'hisaab'));
batch.set(hisaabRef, {
  entityId: CUSTOMER_ID,
  entityType: 'customer',
  entityName: CUSTOMER_NAME,
  date: createdAt,
  description: `Outstanding balance for Invoice ${INVOICE_ID}`,
  cashDebit: BALANCE,
  cashCredit: 0,
  goldDebitGrams: 0,
  goldCreditGrams: 0,
  linkedInvoiceId: INVOICE_ID,
});

await batch.commit();
console.log(`Done — linked ${INVOICE_ID} (${createdAt}) to ${CUSTOMER_NAME} and created hisaab entry of PKR ${BALANCE}.`);
process.exit(0);
