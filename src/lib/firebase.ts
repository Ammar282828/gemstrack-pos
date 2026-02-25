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

// --- Initialize Firebase ---
// This function initializes Firebase and sets up local persistence.
// It ensures that Firebase is only initialized once.
function initializeDb() {
    console.log('[GemsTrack Firebase] Initializing...');

    if (getApps().length) {
        app = getApp();
        console.log('[GemsTrack Firebase] Re-using existing Firebase app.');
    } else {
        app = initializeApp(firebaseConfig);
        console.log('[GemsTrack Firebase] New Firebase app initialized.');
    }

    try {
        // This is the modern, robust way to enable offline persistence.
        db = initializeFirestore(app, {
            localCache: persistentLocalCache(/* No options for single-tab */)
        });
        console.log('[GemsTrack Firebase] Offline persistence enabled.');
    } catch (e: any) {
        console.error('[GemsTrack Firebase] Error initializing Firestore with persistence:', e);
        // Fallback to in-memory DB if persistence fails for any reason
        if (!db) {
            db = getFirestore(app);
            console.warn('[GemsTrack Firebase] Initialized with in-memory cache only.');
        }
    }

    auth = getAuth(app);
}

// Ensure this runs only on the client and only once.
if (typeof window !== 'undefined' && !getApps().length) {
    initializeDb();
} else if (getApps().length) {
    // If app is already initialized (e.g., during hot-reloads), just get the instances
    app = getApp();
    db = getFirestore(app);
    auth = getAuth(app);
}


export { app, auth, db, firebaseConfig, initializeDb };
