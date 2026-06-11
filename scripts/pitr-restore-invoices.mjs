/**
 * Copy all invoices from restore-temp database → live (default) database.
 * 1. Read all invoices from restore-temp
 * 2. Delete all invoices from live
 * 3. Write all backup invoices to live
 */
import admin from 'firebase-admin';

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const CLIENT_EMAIL = 'firebase-adminsdk-fbsvc@hom-pos-52710474-ceeea.iam.gserviceaccount.com';
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD8+pgaHJCIj6/H
bQTCec53SFVoNn8mScDXKyKV1wv9GOACDKZ5AnehMfbOVsapLCe5clfG6zgID42+
NDgp/erwAVKA7U1IuZe8nmwy6ukf23zBMzQocW1VfJqROdRXEQCM0ehjoV7u+w08
mN5YbT0eioqKhP8eDb5oNDkqKASV1L8g67StdCbYkvWPm5jujuJDqdpHXprst9bj
5Umr5XRCPMxFiYqfvoWmGjsVItExuLqx5NDmVLjHKChZ9rW0uGnYb5x+fPB0g+q4
Oc2JznWUCH35jllP41EnKj0ryT8RVQ35kpzv82cpSrQTk2x/6THoiOUQMblL0PrP
qLz3RHRPAgMBAAECggEAD4bN3mRnFoqYbklUTnStZbLMfc3tIIt2833T7JW7SE3G
NI9UNFR2GoWiMT3a3uKKjvOOoZ3UMuJ0KlAIK8OdhMd//yZmujzx1tjI/pheYInX
GVXW21iYLklXL0H5CghNcVcncoiioVD1RK/ZOFzUBdODofF8ZaV69z2lTd9mO0/T
13FIBhiFkHGxNakJBUtuuSDmThXqhj7Yb6yBDUgErW4UBNNs1L3ta5TroUBXeQld
cNKWMM2cxiFZOcmTJRgkv3IqF9Vw+ZMYj8FC9S+Vm0oaggdeMg+nfyA2mvtrBbBX
WVW/S4jh64O1aJ+93WWxM/8BgUk1pEDQfAR1CxdceQKBgQD/ggNAQhhHRC9TDVUt
mBd+1gEwnWqY5huQ4Ymm87SZmQXBijKYj0CXkJ/VWbvskSvjf6HQXLo1toTaRfmg
/HV4jDjgKmKvbTpHb1QsjbyligmaPUCHhp3EMbOaK8ZiW+AKfDcMIbAYoH5uW5oQ
rX4CGtF17KA4Rpn5aexEbofnywKBgQD9d1WeOyqXc4LSTgdIaxRgnQ5BI5s/mjM3
ZssCj49TnvZp/iNk3mXR0IIQT1s4op5Kkngv3UQxvlZrulNzdx0Kp4c7qQ4seGEy
60QIOu/sqnvF9nDPTEh8NoxFlBbuX789+n+G9xyKGgmWlv8ehfecvZnkcEywAMtb
S6q1yf0tDQKBgCW6P9qkJ8uWINrFlDc4Rvfeh6xzAgNzrsxU0SuKvrcTZksuqcvn
EyWOIFuzdVE4Gl/sP6txlblKqxFD1dlUjc/v/JH1ED9RBJL5uFcf0qQq3sIcm0On
t/H5WMjB//gUEt/ZeZNcAhGQ2TpYZkZmJ74N0bH0769/lUrDvjRYkc7DAoGBALDy
dlsYgwtoIJQg1QTBfGBWRHVFHkSwqcCril4nSq/d8bjdKmhoujxXi/VG8TAAlvEI
f88qcUkoz7w1P70EEso1WjtUMgjpoTGi/MOiIYzfF7mD6g1N++x7SEHquHeBcEkc
b5sROGNQ+hCfKUttywcpdh38KA1XAKCjmnF+qbihAoGAO0B0ZUBHV+mHlDUIlnUl
GqVmxYYqKlYDwpw2aHuWkIbKEQmHd6w/GdK3Dgt8h2g4Ttu4cmALcIAWpTj6+Sgr
y/gprkblXA7Mm0HVpQeC5mHPXR0oivrpX1IjHbs21+ZPCPSBlqbzMoC8hP5qN9L3
HKazvm8YEOL2vTRgyrLxikY=
-----END PRIVATE KEY-----
`;

// Initialize two separate firebase-admin apps
const backupApp = admin.initializeApp({
  credential: admin.credential.cert({ projectId: PROJECT_ID, clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY }),
}, 'backup');

const liveApp = admin.initializeApp({
  credential: admin.credential.cert({ projectId: PROJECT_ID, clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY }),
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
