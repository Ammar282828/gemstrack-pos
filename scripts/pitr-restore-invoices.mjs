/**
 * Copy all invoices from restore-temp database → live (default) database.
 * 1. Read all invoices from restore-temp
 * 2. Delete all invoices from live
 * 3. Write all backup invoices to live
 */
import admin from 'firebase-admin';

const PROJECT_ID = 'hom-pos-52710474-ceeea';

// Two firebase-admin apps, signed in as this machine's Google credentials (never a key pasted here)
const backupApp = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID,
}, 'backup');

const liveApp = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID,
}, 'live');

const backupDb = backupApp.firestore();
backupDb.settings({ databaseId: 'restore-temp' });

const liveDb = liveApp.firestore();
// liveDb uses (default) database

async function main() {
  // Step 1: Read all invoices from restore-temp
  console.log('Reading invoices from restore-temp...');
  const backupSnap = await backupDb.collection('invoices').get();
  const backupInvoices = [];
  for (const doc of backupSnap.docs) {
    backupInvoices.push({ id: doc.id, data: doc.data() });
  }
  console.log(`Found ${backupInvoices.length} invoices in restore-temp.`);

  if (backupInvoices.length === 0) {
    console.error('No invoices found in backup! Aborting.');
    process.exit(1);
  }

  // Step 2: Read current live invoices
  console.log('\nReading current live invoices...');
  const liveSnap = await liveDb.collection('invoices').get();
  console.log(`Found ${liveSnap.size} invoices in live database.`);

  // Step 3: Delete all live invoices in batches
  console.log('\nDeleting all live invoices...');
  const BATCH_SIZE = 400;
  const liveDocs = liveSnap.docs;
  for (let i = 0; i < liveDocs.length; i += BATCH_SIZE) {
    const batch = liveDb.batch();
    const chunk = liveDocs.slice(i, i + BATCH_SIZE);
    for (const doc of chunk) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    console.log(`  Deleted batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} docs)`);
  }
  console.log(`Deleted all ${liveDocs.length} live invoices.`);

  // Step 4: Write all backup invoices to live in batches
  console.log('\nWriting backup invoices to live database...');
  for (let i = 0; i < backupInvoices.length; i += BATCH_SIZE) {
    const batch = liveDb.batch();
    const chunk = backupInvoices.slice(i, i + BATCH_SIZE);
    for (const inv of chunk) {
      batch.set(liveDb.collection('invoices').doc(inv.id), inv.data);
    }
    await batch.commit();
    console.log(`  Wrote batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} docs)`);
  }
  console.log(`Wrote all ${backupInvoices.length} invoices to live database.`);

  // Step 5: Verify
  console.log('\nVerifying...');
  const verifySnap = await liveDb.collection('invoices').get();
  console.log(`Live database now has ${verifySnap.size} invoices.`);

  // Show first 5 and last 5
  const sorted = [];
  verifySnap.forEach(d => sorted.push({ id: d.id, customer: d.data().customerName, total: d.data().grandTotal }));
  sorted.sort((a, b) => a.id.localeCompare(b.id));
  console.log('\nFirst 5:');
  sorted.slice(0, 5).forEach(i => console.log(`  ${i.id} — ${i.customer} — PKR ${i.total}`));
  console.log('Last 5:');
  sorted.slice(-5).forEach(i => console.log(`  ${i.id} — ${i.customer} — PKR ${i.total}`));

  console.log('\n✅ Restore complete!');
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
