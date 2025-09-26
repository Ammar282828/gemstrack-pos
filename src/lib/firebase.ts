
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore, enableIndexedDbPersistence, initializeFirestore, CACHE_SIZE_UNLIMITED } from "firebase/firestore";

// --- Your web app's Firebase configuration ---
// This configuration is hardcoded as requested.
const firebaseConfig = {
  apiKey: "AIzaSyAl3W_9_Z9j0sR7rGIwwM1uiiXvOxGQ7IA",
  authDomain: "gemstrack-pos.firebaseapp.com",
  databaseURL: "https://gemstrack-pos-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gemstrack-pos",
  storageBucket: "gemstrack-pos.appspot.com",
  messagingSenderId: "948018742883",
  appId: "1:948018742883:web:a3a090dde378be96089a56"
};

// Initialize Firebase
let app: FirebaseApp;
let db: Firestore;

if (!getApps().length) {
    try {
        app = initializeApp(firebaseConfig);
        db = initializeFirestore(app, {
            cacheSizeBytes: CACHE_SIZE_UNLIMITED
        });
        console.log("[GemsTrack Firebase Setup] Firebase app initialized successfully.");
    } catch (error) {
        console.error("[GemsTrack Firebase Setup] ERROR INITIALIZING FIREBASE APP:", error);
        // @ts-ignore 
        app = {} as FirebaseApp; 
        // @ts-ignore
        db = {} as Firestore;
    }
} else {
  app = getApp();
  db = getFirestore(app);
  console.log("[GemsTrack Firebase Setup] Using existing Firebase app instance.");
}

// Enable persistence
if (typeof window !== 'undefined' && db) {
  enableIndexedDbPersistence(db)
    .then(() => console.log("[GemsTrack Firebase Setup] Firestore offline persistence enabled."))
    .catch((err) => {
      if (err.code == 'failed-precondition') {
        console.warn("[GemsTrack Firebase Setup] Multiple tabs open, persistence can only be enabled in one tab at a time.");
      } else if (err.code == 'unimplemented') {
        console.warn("[GemsTrack Firebase Setup] The current browser does not support all of the features required to enable persistence.");
      } else {
        console.error("[GemsTrack Firebase Setup] Error enabling persistence:", err);
      }
    });
}

// Conditionally initialize Auth only if the app seems valid
let auth: Auth;
// @ts-ignore
if (app && app.name && app.options?.apiKey) {
  try {
    auth = getAuth(app);
    console.log("[GemsTrack Firebase Setup] Firebase Auth service obtained.");
  } catch (error) {
    console.error("[GemsTrack Firebase Setup] Error getting Auth service AFTER app initialization.", error);
     // @ts-ignore
    auth = {} as Auth; 
  }
} else {
  console.error("[GemsTrack Firebase Setup] Firebase Auth NOT initialized because the Firebase app instance appears invalid or unconfigured.");
   // @ts-ignore
  auth = {} as Auth; 
}


export { app, auth, db };
