
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// --- Your web app's Firebase configuration ---
// This configuration is hardcoded as requested.
const firebaseConfig = {
  apiKey: "AIzaSyAl3W_9_Z9j0sR7rGIwwM1uiiXvOxGQ7IA",
  authDomain: "gemstrack-pos.firebaseapp.com",
  projectId: "gemstrack-pos",
  storageBucket: "gemstrack-pos.appspot.com",
  messagingSenderId: "948018742883",
  appId: "1:948018742883:web:a3a090dde378be96089a56"
};

// Initialize Firebase
let app: FirebaseApp;
if (!getApps().length) {
    try {
        app = initializeApp(firebaseConfig);
        console.log("[GemsTrack Firebase Setup] Firebase app initialized successfully with provided config.");
    } catch (error) {
        console.error("[GemsTrack Firebase Setup] ERROR INITIALIZING FIREBASE APP:", error);
        // @ts-ignore 
        app = {} as FirebaseApp; // Assign a dummy app to prevent further crashes down the line
    }
} else {
  app = getApp();
  console.log("[GemsTrack Firebase Setup] Using existing Firebase app instance.");
}

// Conditionally initialize Auth and Firestore only if the app seems valid
let auth: Auth;
let db: Firestore;

// @ts-ignore
if (app && app.name && app.options?.apiKey) { // Check if app is a real FirebaseApp instance
  try {
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("[GemsTrack Firebase Setup] Firebase Auth and Firestore services obtained.");
  } catch (error) {
    console.error("[GemsTrack Firebase Setup] Error getting Auth or Firestore service AFTER app initialization.", error);
     // @ts-ignore
    auth = {} as Auth; 
     // @ts-ignore
    db = {} as Firestore;
  }
} else {
  console.error("[GemsTrack Firebase Setup] Firebase Auth and Firestore NOT initialized because the Firebase app instance appears invalid or unconfigured.");
   // @ts-ignore
  auth = {} as Auth; 
   // @ts-ignore
  db = {} as Firestore;
}

export { app, auth, db };
