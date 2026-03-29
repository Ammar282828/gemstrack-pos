import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!privateKey || !clientEmail || !projectId) {
    throw new Error(
      'Missing Firebase Admin credentials. Add FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL to .env.local'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

export const adminDb = admin.firestore();
