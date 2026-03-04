import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';

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

const BANK_ACCOUNT = {
  id: `pm-${Date.now()}`,
  bankName: 'Bank Al-Habib',
  accountName: 'House of Mina',
  accountNumber: '1227098100227801',
  iban: 'PK42 BAHL 1227 0981 0022 7801',
};

async function main() {
  const settingsRef = doc(db, 'app_settings', 'global');
  const snap = await getDoc(settingsRef);

  if (!snap.exists()) {
    console.error('❌ Settings document not found.');
    process.exit(1);
  }

  const existing = snap.data().paymentMethods || [];
  const alreadyExists = existing.some(m => m.iban === BANK_ACCOUNT.iban || m.accountNumber === BANK_ACCOUNT.accountNumber);

  if (alreadyExists) {
    console.log('ℹ️  Bank account already exists in payment methods — no changes made.');
    process.exit(0);
  }

  await updateDoc(settingsRef, {
    paymentMethods: arrayUnion(BANK_ACCOUNT),
  });

  console.log('✅ Bank account added successfully:');
  console.log(`   Bank:   ${BANK_ACCOUNT.bankName}`);
  console.log(`   Name:   ${BANK_ACCOUNT.accountName}`);
  console.log(`   Acct#:  ${BANK_ACCOUNT.accountNumber}`);
  console.log(`   IBAN:   ${BANK_ACCOUNT.iban}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
