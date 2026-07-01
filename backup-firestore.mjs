// One-off Firestore backup → local JSON. Reads admin creds from the env that
// `dotenv -e <file>` loads (NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY). Dumps every root collection to a timestamped file.
import admin from 'firebase-admin';
import { writeFileSync, mkdirSync } from 'fs';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing admin creds (need projectId, clientEmail, privateKey).');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
const db = admin.firestore();

const outDir = '/Users/ammarmansa/firestore-backups';
mkdirSync(outDir, { recursive: true });

const collections = await db.listCollections();
const dump = {};
let total = 0;
for (const col of collections) {
  const snap = await col.get();
  dump[col.id] = {};
  snap.forEach(doc => { dump[col.id][doc.id] = doc.data(); });
  total += snap.size;
  console.log(`  ${col.id}: ${snap.size} docs`);
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const file = `${outDir}/${projectId}__${ts}.json`;
writeFileSync(file, JSON.stringify(dump, (_k, v) => v, 2));
console.log(`\n✅ ${total} docs across ${collections.length} collections`);
console.log(`📄 ${file}`);
process.exit(0);
