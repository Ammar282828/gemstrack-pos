import admin from 'firebase-admin';
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'gemstrack-pos' });
const db = admin.firestore();
for (const c of ['customers','karigars','hisaab','orders','voice_aliases']) {
  try {
    const s = await db.collection(c).count().get();
    console.log(`  ${c.padEnd(14)} ${s.data().count}`);
  } catch (e) {
    console.log(`  ${c.padEnd(14)} ERROR ${e.code ?? ''} ${(e.message||'').split('\n')[0].slice(0,140)}`);
  }
}
process.exit(0);
