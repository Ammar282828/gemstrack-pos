import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';

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

const ref = doc(db, 'app_settings', 'global');
const snap = await getDoc(ref);
const d = snap.data();

console.log('--- Current Firestore Settings ---');
const keys = ['shopName','goldRatePerGram24k','goldRatePerGram22k','goldRatePerGram21k','goldRatePerGram18k','silverRatePerGram','palladiumRatePerGram','platinumRatePerGram','lastInvoiceNumber','lastOrderNumber','theme'];
keys.forEach(k => console.log(`  ${k}: ${d[k]}`));

process.exit(0);
