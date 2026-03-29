import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId   = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (privateKey && clientEmail) {
    // Local dev: use service account key from .env.local
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  } else {
    // Deployed on Firebase/GCP: use Application Default Credentials
    admin.initializeApp({ projectId });
  }
}

export const adminDb = admin.firestore();
