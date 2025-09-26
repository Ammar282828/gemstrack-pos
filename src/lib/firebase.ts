

// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp, deleteApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore, enableIndexedDbPersistence, initializeFirestore, CACHE_SIZE_UNLIMITED, terminate } from "firebase/firestore";

// --- Your web app's Firebase configuration ---
// This is the REAL configuration.
const firebaseConfig = {
  apiKey: "AIzaSyAl3W_9_Z9j0sR7rGIwwM1uiiXvOxGQ7IA",
  authDomain: "gemstrack-pos.firebaseapp.com",
  databaseURL: "https://gemstrack-pos-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gemstrack-pos",
  storageBucket: "gemstrack-pos.appspot.com",
  messagingSenderId: "948018742883",
  appId: "1:948018742883:web:a3a090dde378be96089a56"
};

// This is a BOGUS configuration used to effectively "disconnect" the app.
const bogusFirebaseConfig = {
  apiKey: "bogus",
  authDomain: "bogus.firebaseapp.com",
  projectId: "bogus",
  storageBucket: "bogus.appspot.com",
  messagingSenderId: "0",
  appId: "bogus"
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

let isInitialized = false;

async function reinitializeFirebase(locked: boolean) {
    console.log(`[GemsTrack Firebase] Re-initializing with locked status: ${locked}`);
    
    // Terminate existing services if they exist
    if (isInitialized) {
        try {
            await terminate(db);
            await deleteApp(app);
            console.log("[GemsTrack Firebase] Previous Firebase app instance terminated.");
        } catch (error) {
            console.error("[GemsTrack Firebase] Error terminating previous Firebase instance:", error);
        }
    }

    const configToUse = locked ? bogusFirebaseConfig : firebaseConfig;
    
    app = initializeApp(configToUse);
    db = initializeFirestore(app, {
        cacheSizeBytes: CACHE_SIZE_UNLIMITED
    });
    auth = getAuth(app);
    isInitialized = true;
    console.log(`[GemsTrack Firebase] Services initialized. Locked: ${locked}`);

    if (typeof window !== 'undefined' && !locked) {
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
    
    // Return the new instances so they can be used immediately if needed
    return { app, auth, db };
}

// Ensure db, auth, app are exported but only initialized via reinitializeFirebase.
// This prevents any module-level execution that depends on uninitialized values.
export { app, auth, db, reinitializeFirebase };
