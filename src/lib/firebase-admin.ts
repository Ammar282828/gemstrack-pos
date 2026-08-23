import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // verifyIdToken checks the token's audience against the project, so an
  // undefined projectId makes every token look invalid — which surfaced as a
  // blanket "Unauthorized" on every owner-gated route in production, where
  // NEXT_PUBLIC_FIREBASE_PROJECT_ID was never set. App Hosting always
  // provides GOOGLE_CLOUD_PROJECT, so fall through to it.
  const projectId   = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.FIREBASE_PROJECT_ID;

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
export const adminAuth = admin.auth();
