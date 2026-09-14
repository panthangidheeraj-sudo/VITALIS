/**
 * Firebase, initialised DEFENSIVELY — because getting this wrong took the
 * whole site down.
 *
 * WHAT HAPPENED: this module used to call `initializeApp()` and `getAuth()` at
 * the top level. `import.meta.env.VITE_FIREBASE_*` is inlined by Vite AT BUILD
 * TIME, and the Render web service was built without those variables set, so
 * every field compiled to `undefined` and `getAuth()` threw
 * `auth/invalid-api-key` while the entry chunk was still evaluating. That
 * happens before `createRoot().render()` in main.tsx, so React never mounted at
 * all — and the JS-free placeholder inside `index.html`'s `#root` stayed on
 * screen forever. The reported symptom was "stuck on the intro splash"; the
 * intro component was never even reached.
 *
 * THE RULE THIS FILE NOW FOLLOWS: an optional feature may not be able to
 * prevent the application from starting. Sign-in is optional — every screen
 * works without it — so a missing or invalid config degrades sign-in and
 * nothing else. Behaviour when the config IS present is unchanged.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

/**
 * The two fields Firebase Auth cannot work without. Checked BEFORE calling
 * into the SDK, so the common misconfiguration never reaches the code path
 * that throws.
 */
function hasUsableConfig(): boolean {
  return (
    typeof firebaseConfig.apiKey === 'string' &&
    firebaseConfig.apiKey.length > 0 &&
    typeof firebaseConfig.authDomain === 'string' &&
    firebaseConfig.authDomain.length > 0
  );
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let googleProvider: GoogleAuthProvider | undefined;

if (hasUsableConfig()) {
  // Still wrapped: a malformed-but-present key (a truncated paste, a stale
  // project) throws from the same call, and that must not be fatal either.
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
  } catch (error) {
    console.error('[vitalis] Firebase auth is unavailable; sign-in is disabled.', error);
    app = undefined;
    auth = undefined;
    googleProvider = undefined;
  }
} else if (import.meta.env.DEV) {
  console.warn(
    '[vitalis] VITE_FIREBASE_API_KEY / VITE_FIREBASE_AUTH_DOMAIN are not set — ' +
      'sign-in is disabled. Everything else works. Set them at BUILD time (they are ' +
      'inlined by Vite, not read at runtime) if you want Google sign-in.',
  );
}

/** `undefined` when Firebase is not configured — callers must handle that. */
export { app, auth, googleProvider };

/** Lets the UI say "sign-in is unavailable" instead of silently doing nothing. */
export const isFirebaseConfigured = (): boolean => auth !== undefined;
