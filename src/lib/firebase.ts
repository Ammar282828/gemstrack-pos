
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore, initializeFirestore, persistentLocalCache } from "firebase/firestore";

// --- Firebase configuration — set per-store via environment variables ---
// Silver store values are the fallback defaults.
const firebaseConfig = {
    apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY             ?? "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
    authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN          ?? "hom-pos-52710474-ceeea.firebaseapp.com",
    projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID            ?? "hom-pos-52710474-ceeea",
    storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET        ?? "hom-pos-52710474-ceeea.firebasestorage.app",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID   ?? "288366939838",
    appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID                ?? "1:288366939838:web:044c8eec0a5610688798ef",
  };
  
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

if (getApps().length === 0) {
  console.log('[GemsTrack Firebase] Initializing new Firebase App instance.');
  app = initializeApp(firebaseConfig);
  try {
    // We are disabling persistent cache to avoid synchronization issues across devices.
    // The previous implementation used persistentLocalCache({}) which could lead to stale data.
    // db = initializeFirestore(app, {
    //   localCache: persistentLocalCache({})
    // });
    db = getFirestore(app);
    console.log('[GemsTrack Firebase] New Firestore instance (in-memory persistence) created.');
  } catch (e) {
    console.error('[GemsTrack Firebase] Failed to initialize Firestore:', e);
    db = getFirestore(app);
  }
  auth = getAuth(app);
} else {
  console.log('[GemsTrack Firebase] Re-using existing Firebase App instance.');
  app = getApp();
  auth = getAuth(app);
  db = getFirestore(app); // Get the already initialized instance
}


export { app, auth, db, firebaseConfig };
