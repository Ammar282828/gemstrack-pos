import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8');
const envVars = Object.fromEntries(
  env.split('\n').filter(line => line.includes('=')).map(line => {
    const idx = line.indexOf('=');
    return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
  })
);

const app = initializeApp({ projectId: envVars['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] });
const db = getFirestore(app);

const snap = await db.collection('app_settings').doc('global').get();
if (!snap.exists) {
  console.log('NO SETTINGS DOCUMENT FOUND');
  process.exit(0);
}

const s = snap.data();
console.log('=== Current Firestore Settings ===');
console.log('shopName:          ', s.shopName);
console.log('shopAddress:       ', s.shopAddress);
console.log('shopContact:       ', s.shopContact);
console.log('shopLogoUrl:       ', s.shopLogoUrl ? s.shopLogoUrl.substring(0, 80) + '...' : '(empty)');
console.log('shopLogoUrlBlack:  ', s.shopLogoUrlBlack ? s.shopLogoUrlBlack.substring(0, 80) + '...' : '(empty)');
console.log('goldRatePerGram24k:', s.goldRatePerGram24k);
console.log('goldRatePerGram22k:', s.goldRatePerGram22k);
console.log('goldRatePerGram21k:', s.goldRatePerGram21k);
console.log('goldRatePerGram18k:', s.goldRatePerGram18k);
console.log('silverRatePerGram: ', s.silverRatePerGram);
console.log('lastInvoiceNumber: ', s.lastInvoiceNumber);
console.log('lastOrderNumber:   ', s.lastOrderNumber);
console.log('theme:             ', s.theme);
process.exit(0);
