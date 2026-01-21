

// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore, enableIndexedDbPersistence, initializeFirestore, CACHE_SIZE_UNLIMITED } from "firebase/firestore";

// --- Your web app's Firebase configuration ---
// This is the REAL configuration.
const firebaseConfig = {
    apiKey: "AIzaSyBT0K-wlSllEqY9MU_MunEMUb7puAd4-Lc",
    authDomain: "silver-brand-pos.firebaseapp.com",
    projectId: "silver-brand-pos",
    storageBucket: "silver-brand-pos.firebasestorage.app",
    messagingSenderId: "139998321108",
    appId: "1:139998321108:web:8e5c0db3549c014d479e41",
    measurementId: "G-199P011BHT"
  };
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

// Standard pattern to initialize Firebase, preventing duplication.
if (!getApps().length) {
    console.log("[GemsTrack Firebase] No Firebase app found. Initializing...");
    app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
        cacheSizeBytes: CACHE_SIZE_UNLIMITED
    });
    auth = getAuth(app);
    if (typeof window !== 'undefined') {
        enableIndexedDbPersistence(db)
            .then(() => console.log("[GemsTrack Firebase] Offline persistence enabled."))
            .catch((err) => {
                 if (err.code === 'failed-precondition') {
                    console.warn("[GemsTrack Firebase] Multiple tabs open, persistence can only be enabled in one tab at a time.");
                } else if (err.code === 'unimplemented') {
                    console.warn("[GemsTrack Firebase] The current browser does not support all of the features required to enable persistence.");
                }
            });
    }
} else {
    console.log("[GemsTrack Firebase] Existing Firebase app found. Getting instance...");
    app = getApp();
    db = getFirestore(app);
    auth = getAuth(app);
}

export { app, auth, db, firebaseConfig };
