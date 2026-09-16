
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

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
    /**
     * The book stays on the device between opens.
     *
     * Every collection in the store is read through onSnapshot, and with a persistent
     * cache a listener answers first from disk and then from the server — so the
     * second open of the day paints from what the device already has, and only the
     * documents that changed travel. Without this, every open pulled the whole book
     * (about a megabyte, most of it order photos stored inline) from Iowa to Karachi
     * before a single list could show, and "load times are slow" was the result.
     *
     * The stale-data worry that had this switched off was about one-shot reads. A
     * listener corrects itself the moment the server answers; nothing here is read
     * once and trusted.
     *
     * The multi-tab manager is what lets a second tab share the cache instead of
     * failing to open it.
     */
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    console.log('[GemsTrack Firebase] Firestore instance with on-device cache created.');
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
