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

/**
 * The house's Storage bucket, where the browser puts a piece's photo (product-form.tsx, the client SDK's
 * `getStorage()`): the same NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, with the same fallback as lib/firebase.ts, so
 * a photo the phone sends lands beside the ones the web sent. A function, not a constant: the routes that
 * never touch Storage never load it.
 */
export const adminBucket = () => admin.storage().bucket(
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || 'hom-pos-52710474-ceeea.firebasestorage.app',
);
