import admin from 'firebase-admin';

// Signs in as this machine's Google credentials (`gcloud auth application-default login`, or
// GOOGLE_APPLICATION_CREDENTIALS pointing at a key kept outside the repo). Never paste a key here.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'hom-pos-52710474-ceeea',
});

const db = admin.firestore();
const snap = await db.collection('customers').where('shopifyCustomerId', '!=', '').get();

// A word is garbage if it has 3+ uppercase letters after position 0
// (real names are TitleCase: only 1 uppercase per word)
function isGarbageName(name) {
  if (!name) return false;
  const words = name.trim().split(/\s+/);
  for (const word of words) {
    if (word.length >= 6 && /[A-Z].*[A-Z].*[A-Z]/.test(word.slice(1))) return true;
  }
  return false;
}

const toDelete = [];
for (const doc of snap.docs) {
  const d = doc.data();
  if (isGarbageName(d.name)) toDelete.push(doc.id);
}

console.log(`Deleting ${toDelete.length} garbage customers...`);

for (let i = 0; i < toDelete.length; i += 500) {
  const batch = db.batch();
  for (const id of toDelete.slice(i, i + 500)) {
    batch.delete(db.collection('customers').doc(id));
  }
  await batch.commit();
}

console.log(`Done. Deleted: ${toDelete.join(', ')}`);
process.exit(0);
