
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
  
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth: Auth = getAuth(app);

// Initialize Firestore with persistence enabled.
// The try/catch handles HMR where the instance might already be initialized.
let db: Firestore;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({})
  });
  console.log('[GemsTrack Firebase] Offline persistence enabled.');
} catch (e) {
  // This will likely throw on hot-reloads, which is fine.
  // We can then just get the existing instance.
  db = getFirestore(app);
  console.log("[GemsTrack Firebase] Re-using existing Firestore instance.");
}


export { app, auth, db, firebaseConfig };

