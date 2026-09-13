/**
 * Firebase initialisation for React Native.
 *
 * Uses the Firebase JS SDK rather than @react-native-firebase. That choice is
 * what keeps the app running in Expo Go: @react-native-firebase ships native
 * modules, which would force a development build and a 10–20 minute rebuild on
 * every native dependency change. The JS SDK needs no native code at all.
 *
 * The two RN-specific details that trip people up, both handled below:
 *
 *  1. `initializeAuth` with `getReactNativePersistence(AsyncStorage)`. Calling
 *     plain `getAuth()` in RN leaves auth in memory only, so the user is
 *     silently signed out on every reload — and with the security rules in
 *     firebase/firestore.rules requiring `request.auth != null`, that means
 *     the case listener stops returning data after a refresh.
 *  2. Only the PUBLIC web config lives here (`EXPO_PUBLIC_*`). These values
 *     ship inside the app binary and are public by design — Firestore rules,
 *     not secrecy, are what protect the data. No Groq, Infermedica or Twilio
 *     key is ever present on the device (spec §3.1).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, initializeAuth, signInAnonymously, type Auth } from 'firebase/auth';
// `getReactNativePersistence` is imported from the SCOPED package, not from
// `firebase/auth`. The `firebase` umbrella's "./auth" export map has no
// "react-native" condition, so both TypeScript and the bundler get the browser
// typings there and the symbol appears not to exist. `@firebase/auth` DOES
// declare that condition (-> dist/rn), which is the build that actually has it.
// Expo's tsconfig already sets customConditions: ["react-native"], so this
// resolves correctly for types, and Metro resolves the same condition at
// runtime — it is the same module instance either way, not a second copy.
import { getReactNativePersistence } from '@firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

// Dot-notation only — see the matching comment in src/api/client.ts. Bracket
// access here specifically means `isFirebaseConfigured()` was false on every
// physical device, so the live Firestore listener never activated and every
// screen silently ran on POST-response state alone rather than the shared
// live view. That is not a cosmetic miss; it is the feature the demo's whole
// "live update on a second device" story depends on.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return (
    typeof firebaseConfig.projectId === 'string' &&
    firebaseConfig.projectId.length > 0 &&
    typeof firebaseConfig.apiKey === 'string' &&
    firebaseConfig.apiKey.length > 0
  );
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function ensureApp(): FirebaseApp {
  if (app !== undefined) return app;
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Firebase is not configured. Copy packages/mobile/.env.example to .env and fill in the EXPO_PUBLIC_FIREBASE_* values.',
    );
  }
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig as Record<string, string>);
  return app;
}

function ensureAuth(): Auth {
  if (auth !== undefined) return auth;
  const instance = ensureApp();
  try {
    auth = initializeAuth(instance, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // initializeAuth throws if auth was already initialised for this app
    // (common under Fast Refresh, which re-runs modules but keeps native state).
    auth = getAuth(instance);
  }
  return auth;
}

/**
 * The Auth instance, for callers that need it directly (Google linking).
 * Exported rather than re-deriving it, so there is exactly one initialisation
 * path and the React Native persistence setup above cannot be bypassed.
 */
export function getAuthInstance(): Auth {
  return ensureAuth();
}

export function getDb(): Firestore {
  if (db !== undefined) return db;
  db = getFirestore(ensureApp());
  return db;
}

/**
 * Signs in anonymously so `request.auth` is populated for the security rules.
 *
 * Resolves to false rather than throwing when sign-in fails: with Firestore in
 * test mode (as the README setup describes) reads still succeed without auth,
 * so a failure here should degrade the app, not break it. The caller decides
 * whether to surface it.
 */
export async function ensureSignedIn(): Promise<boolean> {
  try {
    const instance = ensureAuth();
    if (instance.currentUser !== null) return true;
    await signInAnonymously(instance);
    return true;
  } catch (err) {
    console.warn('[firebase] anonymous sign-in failed:', err);
    return false;
  }
}

export function currentUid(): string | undefined {
  return auth?.currentUser?.uid;
}
