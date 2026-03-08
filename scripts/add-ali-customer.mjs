import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, updateDoc } from 'firebase/firestore';

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
  const customerId = `cust-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const createdAt = new Date().toISOString();

  const customer = {
    id: customerId,
    name: 'Ali',
    contact: '+923008252406',
    email: 'mshaikhali@yahoo.com',
    address: '112/2 8th street Khayaban e rahat dha phase 6, Karachi, Pakistan',
    createdAt,
    source: 'shopify_import',
  };

  await setDoc(doc(db, 'customers', customerId), customer);
  console.log(`✅ Customer created: ${customerId}`);

  // Link to invoice
  await updateDoc(doc(db, 'invoices', 'INV-000153'), { customerId });
  console.log(`✅ Invoice INV-000153 linked to customer ${customerId}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
