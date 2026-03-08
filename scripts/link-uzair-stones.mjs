import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

const app = initializeApp({ apiKey: 'AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4', authDomain: 'hom-pos-52710474-ceeea.firebaseapp.com', projectId: 'hom-pos-52710474-ceeea' });
const db = getFirestore(app);

const karigarsSnap = await getDocs(collection(db, 'karigars'));
const uzair = karigarsSnap.docs.map(d => ({ id: d.id, ...d.data() })).find(k => k.name?.toLowerCase().includes('uzair'));

const expensesSnap = await getDocs(collection(db, 'expenses'));
const toLink = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => {
  const desc = (e.description || '').toLowerCase();
  return desc.includes('uzair') && desc.includes('stone') && !e.karigarId;
});

console.log('Uzair karigar:', uzair?.name, uzair?.id);
console.log('Uzair Stone expenses to link:', toLink.length);
toLink.forEach(e => console.log(' ', e.date?.slice(0,10), e.description, 'PKR', e.amount?.toLocaleString()));

if (toLink.length > 0) {
  const batch = writeBatch(db);
  toLink.forEach(e => batch.update(doc(db, 'expenses', e.id), { karigarId: uzair.id }));
  await batch.commit();
  console.log('✅ Done');
} else {
  console.log('Nothing to do');
}
process.exit(0);
