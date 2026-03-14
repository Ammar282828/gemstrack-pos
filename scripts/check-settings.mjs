import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// Load env vars
const env = readFileSync('.env.local', 'utf8');
const envVars = Object.fromEntries(
  env.split('\n').filter(l => l.includes('=')).map(l => {
    const idx = l.indexOf('=');
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
  })
);

const app = initializeApp({ projectId: envVars['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] });
const db = getFirestore(app);

const snap = await db.collection('app_settings').doc('global').get();
const d = snap.data();
console.log('--- Current Firestore Settings ---');
const show = ['shopName','goldRatePerGram24k','goldRatePerGram22k','goldRatePerGram21k','goldRatePerGram18k','silverRatePerGram','palladiumRatePerGram','platinumRatePerGram','lastInvoiceNumber','lastOrderNumber','theme'];
show.forEach(k => console.log(`${k}: ${d[k]}`));
process.exit(0);
