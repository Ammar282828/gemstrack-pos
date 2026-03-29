import admin from 'firebase-admin';

const privateKey = `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD8+pgaHJCIj6/H\nbQTCec53SFVoNn8mScDXKyKV1wv9GOACDKZ5AnehMfbOVsapLCe5clfG6zgID42+\nNDgp/erwAVKA7U1IuZe8nmwy6ukf23zBMzQocW1VfJqROdRXEQCM0ehjoV7u+w08\nmN5YbT0eioqKhP8eDb5oNDkqKASV1L8g67StdCbYkvWPm5jujuJDqdpHXprst9bj\n5Umr5XRCPMxFiYqfvoWmGjsVItExuLqx5NDmVLjHKChZ9rW0uGnYb5x+fPB0g+q4\nOc2JznWUCH35jllP41EnKj0ryT8RVQ35kpzv82cpSrQTk2x/6THoiOUQMblL0PrP\nqLz3RHRPAgMBAAECggEAD4bN3mRnFoqYbklUTnStZbLMfc3tIIt2833T7JW7SE3G\nNI9UNFR2GoWiMT3a3uKKjvOOoZ3UMuJ0KlAIK8OdhMd//yZmujzx1tjI/pheYInX\nGVXW21iYLklXL0H5CghNcVcncoiioVD1RK/ZOFzUBdODofF8ZaV69z2lTd9mO0/T\n13FIBhiFkHGxNakJBUtuuSDmThXqhj7Yb6yBDUgErW4UBNNs1L3ta5TroUBXeQld\ncNKWMM2cxiFZOcmTJRgkv3IqF9Vw+ZMYj8FC9S+Vm0oaggdeMg+nfyA2mvtrBbBX\nWVW/S4jh64O1aJ+93WWxM/8BgUk1pEDQfAR1CxdceQKBgQD/ggNAQhhHRC9TDVUt\nmBd+1gEwnWqY5huQ4Ymm87SZmQXBijKYj0CXkJ/VWbvskSvjf6HQXLo1toTaRfmg\n/HV4jDjgKmKvbTpHb1QsjbyligmaPUCHhp3EMbOaK8ZiW+AKfDcMIbAYoH5uW5oQ\nrX4CGtF17KA4Rpn5aexEbofnywKBgQD9d1WeOyqXc4LSTgdIaxRgnQ5BI5s/mjM3\nZssCj49TnvZp/iNk3mXR0IIQT1s4op5Kkngv3UQxvlZrulNzdx0Kp4c7qQ4seGEy\n60QIOu/sqnvF9nDPTEh8NoxFlBbuX789+n+G9xyKGgmWlv8ehfecvZnkcEywAMtb\nS6q1yf0tDQKBgCW6P9qkJ8uWINrFlDc4Rvfeh6xzAgNzrsxU0SuKvrcTZksuqcvn\nEyWOIFuzdVE4Gl/sP6txlblKqxFD1dlUjc/v/JH1ED9RBJL5uFcf0qQq3sIcm0On\nt/H5WMjB//gUEt/ZeZNcAhGQ2TpYYkZmJ74N0bH0769/lUrDvjRYkc7DAoGBALDy\ndlsYgwtoIJQg1QTBfGBWRHVFHkSwqcCril4nSq/d8bjdKmhoujxXi/VG8TAAlvEI\nf88qcUkoz7w1P70EEso1WjtUMgjpoTGi/MOiIYzfF7mD6g1N++x7SEHquHeBcEkc\nb5sROGNQ+hCfKUttywcpdh38KA1XAKCjmnF+qbihAoGAO0B0ZUBHV+mHlDUIlnUl\nGqVmxYYqKlYDwpw2aHuWkIbKEQmHd6w/GdK3Dgt8h2g4Ttu4cmALcIAWpTj6+Sgr\ny/gprkblXA7Mm0HVpQeC5mHPXR0oivrpX1IjHbs21+ZPCPSBlqbzMoC8hP5qN9L3\nHKazvm8YEOL2vTRgyrLxikY=\n-----END PRIVATE KEY-----\n`.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: 'hom-pos-52710474-ceeea',
    clientEmail: 'firebase-adminsdk-fbsvc@hom-pos-52710474-ceeea.iam.gserviceaccount.com',
    privateKey,
  }),
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
