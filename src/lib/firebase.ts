// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

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
        console.log('[GemsTrack Firebase] Already initialized.');
        app = getApp();
    } else {
        console.log('[GemsTrack Firebase] No Firebase app found. Initializing...');
        app = initializeApp(firebaseConfig);
    }

    try {
        // This is the modern way to enable offline persistence for multiple tabs.
        db = initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        });
        console.log('[GemsTrack Firebase] Offline persistence enabled with multi-tab support.');
    } catch (e: any) {
        if (e.code === 'failed-precondition') {
            console.warn('[GemsTrack Firebase] Multiple tabs open, trying single-tab persistence.');
             try {
                db = initializeFirestore(app, { localCache: persistentLocalCache() });
                console.log('[GemsTrack Firebase] Offline persistence enabled for single tab.');
             } catch(e2: any) {
                console.error('[GemsTrack Firebase] Error initializing Firestore with single-tab persistence:', e2);
             }
        } else if (e.code === 'unimplemented') {
            console.warn('[GemsTrack Firebase] The current browser does not support all of the features required to enable persistence.');
        } else if (!db) {
            console.error('[GemsTrack Firebase] Error initializing Firestore. Have you enabled it in the Firebase console?');
            console.error(e);
        }
    }

    auth = getAuth(app);
}
if (typeof window !== 'undefined') {
    initializeDb();
}


export { app, auth, db, firebaseConfig, initializeDb };
