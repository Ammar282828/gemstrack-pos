
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
// 3. After updating .env.local, YOU MUST RESTART your Next.js development server.
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
console.log("[GemsTrack Firebase Setup] Initializing Firebase with config:", firebaseConfig);

if (!firebaseConfig.apiKey) {
  console.error(
    `[GemsTrack Firebase Setup] CRITICAL ERROR: Firebase API Key (NEXT_PUBLIC_FIREBASE_API_KEY) is missing or undefined in the environment variables.
    Please ensure:
    1. You have a .env.local file at the root of your project.
    2. It contains a line like: NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_ACTUAL_API_KEY
    3. You have restarted your Next.js development server after creating or modifying .env.local.
    
    The application will likely fail to connect to Firebase services without a valid API key.`
  );
} else if (firebaseConfig.apiKey === "YOUR_API_KEY_HERE" || firebaseConfig.apiKey.includes("YOUR_")) {
  console.warn(
    `[GemsTrack Firebase Setup] WARNING: The Firebase API Key seems to be a placeholder value.
    Please replace "YOUR_API_KEY_HERE" (or similar) in your .env.local file with your actual Firebase API key.
    You can find this in your Firebase project settings.`
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
