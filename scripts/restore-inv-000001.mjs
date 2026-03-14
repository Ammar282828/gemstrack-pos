import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const homApp = initializeApp({
  apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4',
  authDomain: 'hom-pos-52710474-ceeea.firebaseapp.com',
  projectId: 'hom-pos-52710474-ceeea',
  storageBucket: 'hom-pos-52710474-ceeea.firebasestorage.app',
  messagingSenderId: '288366939838',
  appId: '1:288366939838:web:044c8eec0a5610688798ef',
}, 'hom');

const db = getFirestore(homApp);

// CSV: #1001, 2024-10-05 17:26:45 +0500, Zarak, "Sana - XS", PKR 15000, paid, fulfilled
// First Shopify order → originally INV-000001
const createdAt = new Date('2024-10-05T17:26:45+05:00').toISOString();

await setDoc(doc(db, 'invoices', 'INV-000001'), {
  id: 'INV-000001',
  shopifyOrderName: '#1001',
  customerId: '',
  customerName: 'Zarak',
  customerContact: '',
  items: [{
    sku: 'SHOP-1001',
    name: 'Sana - XS',
    categoryId: '',
    metalType: 'gold',
    karat: '21k',
    metalWeightG: 0,
    stoneWeightG: 0,
    quantity: 1,
    unitPrice: 15000,
    itemTotal: 15000,
    metalCost: 0,
    wastageCost: 0,
    wastagePercentage: 0,
    makingCharges: 15000,
    diamondChargesIfAny: 0,
    stoneChargesIfAny: 0,
    miscChargesIfAny: 0,
  }],
  subtotal: 15000,
  discountAmount: 0,
  grandTotal: 15000,
  amountPaid: 15000,
  balanceDue: 0,
  createdAt,
  ratesApplied: {},
  paymentHistory: [{ amount: 15000, date: createdAt, notes: 'Shopify payment' }],
  source: 'shopify_import',
});

console.log('✅ INV-000001 restored: Zarak — Sana-XS — PKR 15,000 (shopify_import, #1001)');
