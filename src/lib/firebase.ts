
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// --- Your web app's Firebase configuration ---
// These values MUST be sourced from your .env.local file at the ROOT of your project.
// Example .env.local content:
// NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyC...
// NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
// NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
// NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
// NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
// NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abcdef123456
// NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-ABCDEFGHIJ (optional)

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// --- BEGIN CRITICAL DIAGNOSTIC LOGS ---
console.log(
  "\n\n[GemsTrack Firebase Setup] Initializing Firebase. Verifying environment variables..."
);
console.log("----------------------------------------------------------------------");

let allConfigValuesPresent = true;
const requiredKeys: (keyof typeof firebaseConfig)[] = [
  'apiKey', 
  'authDomain', 
  'projectId', 
  'storageBucket', 
  'messagingSenderId', 
  'appId'
];

requiredKeys.forEach(key => {
  const envVarName = `NEXT_PUBLIC_FIREBASE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
  if (!firebaseConfig[key]) {
    console.error(
      `[GemsTrack Firebase Setup] CRITICAL ERROR: Firebase config key "${key}" (expected from env var ${envVarName}) is MISSING or UNDEFINED.`
    );
    allConfigValuesPresent = false;
  } else if (firebaseConfig[key]?.includes("YOUR_") || firebaseConfig[key] === "YOUR_API_KEY_HERE" || (key === 'apiKey' && firebaseConfig[key]?.length < 10)) {
    console.warn(
      `[GemsTrack Firebase Setup] WARNING: Firebase config key "${key}" (from env var ${envVarName}) appears to be a PLACEHOLDER value ("${firebaseConfig[key]}"). Please replace it with your actual Firebase value in .env.local.`
    );
    // It's a placeholder, but for initialization purposes, it's "present" so don't set allConfigValuesPresent to false unless it was also empty.
    if (!firebaseConfig[key]) allConfigValuesPresent = false;
  } else {
    // Mask sensitive keys like apiKey for general logging, but confirm presence.
    const valueToLog = key === 'apiKey' ? '******** (loaded)' : firebaseConfig[key];
    console.log(`[GemsTrack Firebase Setup] ${envVarName}: ${valueToLog}`);
  }
});

if (!allConfigValuesPresent) {
  console.error(
    "\n[GemsTrack Firebase Setup] ONE OR MORE CRITICAL FIREBASE CONFIG VALUES ARE MISSING.\n" +
    "This means the corresponding NEXT_PUBLIC_FIREBASE_... environment variables were not found or are empty.\n" +
    "Please ensure:\n" +
    "  1. You have a file named exactly '.env.local' at the ROOT of your project (NOT inside 'src').\n" +
    "  2. The '.env.local' file contains all necessary lines like: NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id (check spelling and case of variable names).\n" +
    "  3. You have RESTARTED your Next.js development server (e.g., 'npm run dev') after creating or modifying the '.env.local' file.\n\n" +
    "The application WILL NOT be able to connect to Firebase services correctly.\n"
  );
} else {
  console.log("[GemsTrack Firebase Setup] All required Firebase config values appear to be present from environment variables.");
}
console.log("[GemsTrack Firebase Setup] Full Firebase configuration object being used (sensitive values like apiKey will be seen here if .env.local is misconfigured or not read):", firebaseConfig);
console.log("----------------------------------------------------------------------\n");
// --- END CRITICAL DIAGNOSTIC LOGS ---


// Initialize Firebase
let app: FirebaseApp;
if (!getApps().length) {
  // Only initialize if all critical configs are present and seem valid (not just placeholders for critical ones)
  if (allConfigValuesPresent && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_") && firebaseConfig.projectId && !firebaseConfig.projectId.includes("YOUR_")) {
    try {
        app = initializeApp(firebaseConfig);
        console.log("[GemsTrack Firebase Setup] Firebase app initialized successfully.");
    } catch (error) {
        console.error("[GemsTrack Firebase Setup] ERROR INITIALIZING FIREBASE APP:", error);
        console.error("[GemsTrack Firebase Setup] This usually means that even if environment variables were found, some values might be incorrect (e.g., malformed projectId, authDomain) or the Firebase project itself has issues.");
        // @ts-ignore 
        app = {} as FirebaseApp; // Assign a dummy app to prevent further crashes down the line
    }
  } else {
    console.error("[GemsTrack Firebase Setup] Firebase initialization SKIPPED due to missing or placeholder critical configuration. The app WILL NOT function correctly with Firebase.");
    // @ts-ignore 
    app = {} as FirebaseApp; // Fallback to a dummy app
  }
} else {
  app = getApp();
  console.log("[GemsTrack Firebase Setup] Using existing Firebase app instance.");
}

// Conditionally initialize Auth and Firestore only if the app seems valid
let auth: Auth;
let db: Firestore;

// @ts-ignore
if (app && app.name && app.options?.apiKey) { // Check if app is a real FirebaseApp instance with an apiKey
  try {
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("[GemsTrack Firebase Setup] Firebase Auth and Firestore services obtained.");
  } catch (error) {
    console.error("[GemsTrack Firebase Setup] Error getting Auth or Firestore service AFTER app initialization. This could be due to an invalid API key that passed initial checks, or service enablement issues in Firebase console.", error);
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
