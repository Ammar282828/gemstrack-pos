import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, writeBatch } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  projectId: 'hom-pos-52710474-ceeea',
});
const db = getFirestore(app);

const CUSTOMER_ID = 'shopify-cust-1772597672024-47';
const CUSTOMER_NAME = 'Bareeka Raza';
const CREATED_AT = '2026-02-07T00:00:00.000Z';
const GRAND_TOTAL = 9000;
const AMOUNT_PAID = 0;
const BALANCE_DUE = 9000;

// Get current lastInvoiceNumber
const settingsDoc = await getDoc(doc(db, 'app_settings', 'global'));
const lastInvoiceNumber = settingsDoc.data().lastInvoiceNumber || 0;
const nextNum = lastInvoiceNumber + 1;
const invoiceId = `INV-${nextNum.toString().padStart(6, '0')}`;

console.log(`Creating ${invoiceId} for ${CUSTOMER_NAME}...`);

const batch = writeBatch(db);

// Create invoice
batch.set(doc(db, 'invoices', invoiceId), {
  id: invoiceId,
  customerId: CUSTOMER_ID,
  customerName: CUSTOMER_NAME,
  customerContact: '+923363491587',
  items: [{
    sku: 'MANUAL',
    name: 'Ruby Ring - Silver 925',
    categoryId: '',
    metalType: 'silver',
    karat: '925',
    metalWeightG: 0,
    stoneWeightG: 0,
    quantity: 1,
    unitPrice: GRAND_TOTAL,
    itemTotal: GRAND_TOTAL,
    metalCost: 0,
    wastageCost: 0,
    wastagePercentage: 0,
    makingCharges: GRAND_TOTAL,
    diamondChargesIfAny: 0,
    stoneChargesIfAny: 0,
    miscChargesIfAny: 0,
  }],
  subtotal: GRAND_TOTAL,
  discountAmount: 0,
  grandTotal: GRAND_TOTAL,
  amountPaid: AMOUNT_PAID,
  balanceDue: BALANCE_DUE,
  createdAt: CREATED_AT,
  ratesApplied: {},
  paymentHistory: [],
});

// Update lastInvoiceNumber
batch.update(doc(db, 'app_settings', 'global'), { lastInvoiceNumber: nextNum });

// Create hisaab entry
const hisaabRef = doc(collection(db, 'hisaab'));
batch.set(hisaabRef, {
  entityId: CUSTOMER_ID,
  entityType: 'customer',
  entityName: CUSTOMER_NAME,
  date: CREATED_AT,
  description: `Outstanding balance for Invoice ${invoiceId}`,
  cashDebit: BALANCE_DUE,
  cashCredit: 0,
  goldDebitGrams: 0,
  goldCreditGrams: 0,
  linkedInvoiceId: invoiceId,
});

await batch.commit();
console.log(`Done — ${invoiceId} created. Ruby Ring Silver 925, PKR 9,000, unpaid. lastInvoiceNumber → ${nextNum}`);
process.exit(0);
