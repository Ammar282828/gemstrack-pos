
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore, initializeFirestore, persistentLocalCache } from "firebase/firestore";

// --- Your web app's Firebase configuration ---
// This is the REAL configuration.
const firebaseConfig = {
    apiKey: "AIzaSyBJsDVAI_b7RvnSf-cpnSNLXQ-R0OH0qU4",
    authDomain: "hom-pos-52710474-ceeea.firebaseapp.com",
    projectId: "hom-pos-52710474-ceeea",
    storageBucket: "hom-pos-52710474-ceeea.firebasestorage.app",
    messagingSenderId: "288366939838",
    appId: "1:288366939838:web:044c8eec0a5610688798ef"
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
