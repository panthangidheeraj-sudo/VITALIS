/**
 * Everything a sign-in button needs, with no opinion about what it looks like.
 *
 * The UI for this is coming from a designer, so this hook deliberately exposes
 * STATE AND ACTIONS ONLY - no components, no copy, no layout. A button written
 * against it needs three lines:
 *
 *     const auth = useAuth();
 *     if (auth.canUpgrade) <Button title="Keep my medical ID" onPress={auth.signIn} />
 *     if (auth.isUpgraded) <Text>Signed in as {auth.email}</Text>
 *
 * ---------------------------------------------------------------------------
 * ANONYMOUS IS PRIMARY AND THIS HOOK NEVER BLOCKS ON GOOGLE.
 *
 * `uid` is populated from the anonymous session on first launch and is usable
 * immediately. Nothing here gates the emergency flow behind authentication -
 * the one moment a stranger picks up someone's phone to use this app is the
 * moment a Google account is least available, and a login wall in front of an
 * emergency button would be indefensible.
 *
 * Google sign-in is an UPGRADE with exactly one purpose: an anonymous uid dies
 * with the app's storage. Reinstall, clear data, or change phones and the
 * medical profile and case history are unreachable, because the Firestore rules
 * scope everything to that uid. Linking makes the identity portable. The copy
 * on the button should say that - "keep your medical ID if you change phones" -
 * not "sign in to continue", which is both untrue and off-putting.
 * ---------------------------------------------------------------------------
 *
 * THE UID SURVIVING IS THE WHOLE TRICK. `signInWithGoogle` links the credential
 * to the existing anonymous user, so the uid does not change and every case
 * already written stays readable. `uidChanged` is surfaced here because it is
 * the one outcome the UI must react to: it means the account belonged to
 * another device, this device's local cases are now invisible, and the screen
 * has to say so rather than appearing to have lost them.
 */

import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ensureSignedIn, getAuthInstance, isFirebaseConfigured } from './client';
import {
  isGoogleSignInConfigured,
  signInWithGoogle,
  signOutOfGoogle,
  type GoogleSignInResult,
} from './googleAuth';

export interface AuthState {
  /** True until the first auth state callback fires. */
  readonly loading: boolean;
  /** The Firebase uid. Present as soon as anonymous sign-in completes. */
  readonly uid: string | undefined;
  /** True while running on the throwaway anonymous identity. */
  readonly isAnonymous: boolean;
  /** True once a Google account is attached - the identity is now portable. */
  readonly isUpgraded: boolean;
  readonly email: string | undefined;
  readonly displayName: string | undefined;
  /** False when no OAuth client id is configured; hide the button entirely. */
  readonly googleAvailable: boolean;
  /** True when showing a sign-in button would actually do something. */
  readonly canUpgrade: boolean;
  /** Set while the Google browser flow is open, for a spinner. */
  readonly signingIn: boolean;
  /**
   * True when the last sign-in switched to a DIFFERENT uid, because the Google
   * account already belonged to another device. Cases created anonymously on
   * this phone are no longer readable, and the UI must say that plainly.
   */
  readonly switchedAccount: boolean;
  readonly error: string | undefined;
  readonly signIn: () => Promise<GoogleSignInResult>;
  readonly signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [switchedAccount, setSwitchedAccount] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      // The app still runs - first aid, the emergency card, the QR code are all
      // local. Only the live case view needs Firestore. Reporting "not
      // configured" as loading-forever would freeze a usable screen.
      setLoading(false);
      return;
    }

    const auth = getAuthInstance();
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
      // Anonymous sign-in is kicked off here rather than at module load so it
      // retries on every mount if the first attempt failed offline.
      if (next === null) void ensureSignedIn();
    });
    void ensureSignedIn();
    return unsubscribe;
  }, []);

  const signIn = useCallback(async (): Promise<GoogleSignInResult> => {
    setSigningIn(true);
    setError(undefined);
    try {
      const result = await signInWithGoogle();
      if (result.kind === 'failed') setError(result.message);
      if (result.kind === 'not_configured') {
        setError('Google sign-in is not configured in this build.');
      }
      setSwitchedAccount(result.kind === 'switched');
      return result;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await signOutOfGoogle();
    setSwitchedAccount(false);
    // Straight back to a fresh anonymous session, so the app is never in a
    // signed-out state where the emergency button cannot write a case.
    await ensureSignedIn();
  }, []);

  const isAnonymous = user?.isAnonymous ?? true;
  const googleAvailable = isGoogleSignInConfigured();

  return {
    loading,
    uid: user?.uid,
    isAnonymous,
    isUpgraded: user !== null && !user.isAnonymous,
    email: user?.email ?? undefined,
    displayName: user?.displayName ?? undefined,
    googleAvailable,
    canUpgrade: googleAvailable && isAnonymous,
    signingIn,
    switchedAccount,
    error,
    signIn,
    signOut,
  };
}
