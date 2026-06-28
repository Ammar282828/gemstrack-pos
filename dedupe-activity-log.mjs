// Finds & (optionally) removes duplicate `activity_log` rows caused by
// addActivityLog() running INSIDE Firestore transactions (re-run on every retry).
//
// Run dry-run:  npx dotenv -e .env.local -- node dedupe-activity-log.mjs
// Apply delete: npx dotenv -e .env.local -- node dedupe-activity-log.mjs --apply
//
// Safety: House-of-Mina project only; DRY-RUN unless --apply is passed.
import admin from 'firebase-admin';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const APPLY = process.argv.includes('--apply');
const WINDOW_MS = 120 * 1000; // rows within 2 min of each other = retry duplicates

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing admin creds (need projectId, clientEmail, privateKey).');
  process.exit(1);
}
if (!projectId.startsWith('hom-pos')) {
  console.error(`Refusing to run: project "${projectId}" is not House of Mina (hom-pos*).`);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
const db = admin.firestore();
console.log(`Project: ${projectId}   mode: ${APPLY ? 'APPLY (will delete)' : 'DRY-RUN (read-only)'}\n`);

const snap = await db.collection('activity_log').get();
const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
console.log(`Scanning ${rows.length} activity_log rows…`);

// Group by identical content; a true retry-duplicate matches on all of these.
const keyOf = (r) => `${r.eventType}||${r.entityId}||${r.description}||${r.details}`;
const groups = new Map();
for (const r of rows) {
  if (!r.timestamp) continue;
  const k = keyOf(r);
  (groups.get(k) || groups.set(k, []).get(k)).push(r);
}

const toDelete = [];
const byType = {};
for (const list of groups.values()) {
  if (list.length < 2) continue;
  list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let anchor = list[0];
  for (let i = 1; i < list.length; i++) {
    const r = list[i];
    if (new Date(r.timestamp) - new Date(anchor.timestamp) <= WINDOW_MS) {
      toDelete.push(r);                       // within window → duplicate, drop
      byType[r.eventType] = (byType[r.eventType] || 0) + 1;
    } else {
      anchor = r;                             // far apart → separate real event, keep
    }
  }
}

console.log(`\nDuplicate rows: ${toDelete.length} (of ${rows.length})`);
for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(18)} ${c}`);

console.log('\nSample (up to 20):');
for (const r of toDelete.slice(0, 20)) {
  console.log(`  [${r.timestamp}] ${r.eventType} | ${r.description}${r.details ? ' | ' + r.details : ''}`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN — nothing deleted. Re-run with --apply to remove these ${toDelete.length} rows.`);
  process.exit(0);
}

let done = 0;
for (let i = 0; i < toDelete.length; i += 400) {
  const batch = db.batch();
  toDelete.slice(i, i + 400).forEach(r => batch.delete(db.collection('activity_log').doc(r.id)));
  await batch.commit();
  done += Math.min(400, toDelete.length - i);
  console.log(`  deleted ${done}/${toDelete.length}`);
}
console.log(`\n✅ Deleted ${toDelete.length} duplicate rows.`);
process.exit(0);
