/**
 * Restore settings to Firestore.
 * Fill in the values below before running.
 * Requires open Firestore rules.
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

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

const SETTINGS = {
  shopName: "MINA",
  shopAddress: "",
  shopContact: "",

  goldRatePerGram24k: 44882,
  goldRatePerGram22k: 41142,
  goldRatePerGram21k: 39272,
  goldRatePerGram18k: 33662,
  palladiumRatePerGram: 22000,
  platinumRatePerGram: 25000,
  silverRatePerGram: 3500,

  lastInvoiceNumber: 156,
  lastOrderNumber: 12,
  theme: 'slate',
  databaseLocked: false,

  paymentMethods: [
    {
      id: 'pm-restored',
      bankName: 'Bank Al-Habib',
      accountName: 'House of Mina',
      accountNumber: '1227098100227801',
      iban: 'PK42 BAHL 1227 0981 0022 7801',
    }
  ],

  shopLogoUrl: "",
  shopLogoUrlBlack: "",

  allowedDeviceIds: [],
  weprintApiSkus: [],
};

const settingsRef = doc(db, 'app_settings', 'global');
const existing = await getDoc(settingsRef);

if (existing.exists()) {
  const current = existing.data();
  console.log('--- Current Firestore Settings ---');
  const keys = ['shopName', 'goldRatePerGram24k', 'goldRatePerGram22k', 'goldRatePerGram21k', 'goldRatePerGram18k', 'silverRatePerGram', 'palladiumRatePerGram', 'platinumRatePerGram', 'lastInvoiceNumber', 'lastOrderNumber', 'theme'];
  keys.forEach(key => console.log(`  ${key}: ${current[key]}`));

  if (current.shopLogoUrl) SETTINGS.shopLogoUrl = current.shopLogoUrl;
  if (current.shopLogoUrlBlack) SETTINGS.shopLogoUrlBlack = current.shopLogoUrlBlack;
  if (current.firebaseConfig) SETTINGS.firebaseConfig = current.firebaseConfig;
}

await setDoc(settingsRef, SETTINGS, { merge: true });
console.log('Settings restored:');
console.log(JSON.stringify(SETTINGS, null, 2));
process.exit(0);
