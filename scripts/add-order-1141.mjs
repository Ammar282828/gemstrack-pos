import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

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
  // 1. Get current lastInvoiceNumber
  const settingsSnap = await getDoc(doc(db, 'app_settings', 'global'));
  const lastInvoiceNumber = settingsSnap.data()?.lastInvoiceNumber ?? 0;
  const newInvoiceNumber = lastInvoiceNumber + 1;
  const invoiceId = `INV-${newInvoiceNumber.toString().padStart(6, '0')}`;
  console.log(`Creating invoice: ${invoiceId} (previous lastInvoiceNumber was ${lastInvoiceNumber})`);

  // 2. Try to find existing customer "Ali"
  const customersSnap = await getDocs(collection(db, 'customers'));
  let customerId = '';
  const customerDocs = customersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const aliCustomer = customerDocs.find(c =>
    (c.name || '').toLowerCase() === 'ali' &&
    (c.contact || '').replace(/\s/g, '').includes('3008252406')
  ) || customerDocs.find(c => (c.email || '') === 'mshaikhali@yahoo.com');

  if (aliCustomer) {
    customerId = aliCustomer.id;
    console.log(`Matched existing customer: ${aliCustomer.name} (${aliCustomer.id})`);
  } else {
    console.log('No exact customer match found — storing name/contact inline only.');
  }

  // 3. Build the invoice
  const createdAt = new Date('2026-03-08T22:38:00+05:00').toISOString();
  const subtotal = 14000;
  const shippingCost = 250;
  const grandTotal = 14250;
  const amountPaid = 14250; // fully paid

  const invoice = {
    id: invoiceId,
    shopifyOrderName: '#1141',
    customerId,
    customerName: 'Ali',
    customerContact: '+923008252406',
    customerEmail: 'mshaikhali@yahoo.com',
    shippingAddress: '112/2 8th street Khayaban e rahat dha phase 6, Karachi, Pakistan',
    items: [
      {
        sku: 'EMANI',
        name: 'Emani',
        categoryId: '',
        metalType: 'gold',
        karat: '21k',
        metalWeightG: 0,
        stoneWeightG: 0,
        quantity: 1,
        unitPrice: 14000,
        itemTotal: 14000,
        metalCost: 0,
        wastageCost: 0,
        wastagePercentage: 0,
        makingCharges: 14000,
        diamondChargesIfAny: 0,
        stoneChargesIfAny: 0,
        miscChargesIfAny: 0,
      }
    ],
    subtotal,
    shippingCost,
    discountAmount: 0,
    grandTotal,
    amountPaid,
    balanceDue: grandTotal - amountPaid,
    createdAt,
    ratesApplied: {},
    paymentHistory: [
      { amount: amountPaid, date: createdAt, notes: 'Visa ending 6612 — Shopify #1141' }
    ],
    fulfillmentStatus: 'unfulfilled',
    shippingMethod: 'TCS Express Delivery',
    source: 'shopify_import',
  };

  // 4. Write invoice
  await setDoc(doc(db, 'invoices', invoiceId), invoice);
  console.log(`✅ Invoice ${invoiceId} written successfully.`);

  // 5. Update lastInvoiceNumber
  await updateDoc(doc(db, 'app_settings', 'global'), { lastInvoiceNumber: newInvoiceNumber });
  console.log(`✅ app_settings.lastInvoiceNumber updated to ${newInvoiceNumber}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
