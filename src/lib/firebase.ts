
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// These values are sourced from your .env.local file.
// IMPORTANT:
// 1. Ensure these environment variables are correctly set in .env.local
//    at the ROOT of your project.
// 2. The API key (NEXT_PUBLIC_FIREBASE_API_KEY) must be correct and have the
//    necessary permissions and no overly restrictive application/API restrictions
//    in the Google Cloud Console / Firebase project settings.
// 3. After creating or updating .env.local, YOU MUST RESTART your Next.js development server.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // Optional
};

// Log the config to the server console for debugging.
// Check your terminal where `npm run dev` is running.
console.log("[GemsTrack Firebase Setup] Firebase configuration being used:", firebaseConfig);

if (!firebaseConfig.apiKey) {
  console.error(
    `\n\n[GemsTrack Firebase Setup] CRITICAL ERROR: Firebase API Key (NEXT_PUBLIC_FIREBASE_API_KEY) is MISSING or UNDEFINED in the environment variables.\n` +
    `This means the NEXT_PUBLIC_FIREBASE_API_KEY environment variable was not found or is empty when the firebase.ts module was loaded.\n` +
    `Please ensure:\n` +
    `  1. You have a .env.local file at the root of your project.\n` +
    `  2. It contains a line like: NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_ACTUAL_API_KEY\n` +
    `  3. You have RESTARTED your Next.js development server after creating or modifying .env.local.\n\n` +
    `The application WILL NOT be able to connect to Firebase services without a valid API key.\n`
  );
} else if (firebaseConfig.apiKey === "YOUR_API_KEY_HERE" || firebaseConfig.apiKey.includes("YOUR_") || firebaseConfig.apiKey.length < 10) {
  console.warn(
    `\n\n[GemsTrack Firebase Setup] WARNING: The Firebase API Key (NEXT_PUBLIC_FIREBASE_API_KEY) appears to be a PLACEHOLDER value or is very short: "${firebaseConfig.apiKey}".\n` +
    `Please replace it with your actual Firebase API key from your Firebase project settings.\n` +
    `If you have already replaced it, ensure your .env.local file is saved and you have RESTARTED your development server.\n`
  );
}


// Initialize Firebase
let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);

export { app, auth, db };

