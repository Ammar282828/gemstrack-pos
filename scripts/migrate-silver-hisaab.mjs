import admin from 'firebase-admin';

// Signs in as this machine's Google credentials (`gcloud auth application-default login`, or
// GOOGLE_APPLICATION_CREDENTIALS pointing at a key kept outside the repo). Never paste a key here.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'hom-pos-52710474-ceeea',
});

const db = admin.firestore();

// Find karigar hisaab entries with goldCreditGrams > 0 (old silver transactions)
const hisaabSnap = await db.collection('hisaab').where('entityType', '==', 'karigar').get();

const silverEntries = hisaabSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(e => (e.goldCreditGrams || 0) > 0);

console.log(`Found ${silverEntries.length} silver-related hisaab entries to migrate:\n`);

for (const entry of silverEntries) {
  const silverGrams = entry.goldCreditGrams;
  const totalSurcharge = entry.cashDebit || 0;
  const surchargePerGram = silverGrams > 0 ? totalSurcharge / silverGrams : 0;

  console.log(`  ${entry.entityName} — ${silverGrams}g, surcharge PKR ${totalSurcharge} (${surchargePerGram.toFixed(2)}/g)`);
  console.log(`    desc: ${entry.description}`);
  console.log(`    date: ${entry.date}`);

  const silverDoc = {
    karigarId: entry.entityId,
    karigarName: entry.entityName,
    date: entry.date,
    silverGrams,
    surchargePerGram: Math.round(surchargePerGram * 100) / 100,
    totalSurcharge,
    description: entry.description || '',
  };

  const ref = await db.collection('silver_transactions').add(silverDoc);
  console.log(`    ✓ Created silver_transactions/${ref.id}`);

  await db.collection('hisaab').doc(entry.id).delete();
  console.log(`    ✓ Deleted hisaab/${entry.id}\n`);
}

console.log(`Done. Migrated ${silverEntries.length} entries.`);
process.exit(0);
