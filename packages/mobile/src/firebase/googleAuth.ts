/**
 * Google sign-in, layered on top of anonymous auth.
 *
 * ---------------------------------------------------------------------------
 * ANONYMOUS IS PRIMARY. THIS IS AN UPGRADE, NOT A GATE.
 *
 * The app signs in anonymously on first launch and is fully usable that way.
 * Nobody is asked to authenticate before they can call for help - a login wall
 * in front of an emergency button would be indefensible, and the one moment a
 * stranger picks up someone's phone to use this is the moment a Google account
 * is least available.
 *
 * Google sign-in exists for one reason: an anonymous uid lives and dies with
 * the app's storage. Clear the data, reinstall, or switch phones and the
 * medical profile and case history are gone, because the Firestore rules scope
 * everything to that uid. Linking a Google account makes the identity portable.
 * ---------------------------------------------------------------------------
 *
 * LINKING, NOT REPLACING. `linkWithCredential` upgrades the EXISTING anonymous
 * user in place, so the uid never changes and every case already written stays
 * readable. Signing in with Google as a separate user would mint a new uid and
 * silently orphan the entire medical history behind rules that no longer
 * match - the data would still exist and simply never appear again.
 *
 * The one case where linking legitimately fails is `credential-already-in-use`:
 * this Google account is already attached to a different uid, usually because
 * the person signed in on another device first. Then signing in directly IS
 * correct - their real history lives on that other uid, and the anonymous data
 * on this device is the throwaway copy. That branch is handled explicitly
 * below rather than being allowed to surface as an unexplained error.
 */

import {
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signOut,
  type User,
} from 'firebase/auth';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getAuthInstance } from './client';

// Required so the in-app browser hands control back after the Google redirect.
WebBrowser.maybeCompleteAuthSession();

const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

/**
 * Google issues a different OAuth client id per platform, and using the wrong
 * one fails with an opaque redirect_uri_mismatch. All are public values - they
 * identify the app, they do not authorise anything on their own.
 */
function clientId(): string | undefined {
  return (
    process.env['EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID'] ??
    process.env['EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS'] ??
    process.env['EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB']
  );
}

export function isGoogleSignInConfigured(): boolean {
  const id = clientId();
  return typeof id === 'string' && id.length > 0;
}

export type GoogleSignInResult =
  | { readonly kind: 'linked'; readonly user: User; readonly uidChanged: false }
  /** The account already belonged to another uid; we switched to it. */
  | { readonly kind: 'switched'; readonly user: User; readonly uidChanged: true }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'not_configured' }
  | { readonly kind: 'failed'; readonly message: string };

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const id = clientId();
  if (id === undefined) return { kind: 'not_configured' };

  let idToken: string | undefined;
  try {
    const redirectUri = AuthSession.makeRedirectUri();
    const request = new AuthSession.AuthRequest({
      clientId: id,
      redirectUri,
      scopes: ['openid', 'profile', 'email'],
      // The implicit id_token flow avoids needing a client SECRET on the
      // device, which must never ship in an app bundle.
      responseType: AuthSession.ResponseType.IdToken,
      extraParams: { nonce: String(Date.now()) },
    });

    const result = await request.promptAsync(DISCOVERY);
    if (result.type === 'dismiss' || result.type === 'cancel') return { kind: 'cancelled' };
    if (result.type !== 'success') {
      return { kind: 'failed', message: 'Google sign-in did not complete.' };
    }
    idToken = result.params['id_token'];
  } catch (err) {
    return {
      kind: 'failed',
      message: err instanceof Error ? err.message : 'Google sign-in failed.',
    };
  }

  if (idToken === undefined) {
    return { kind: 'failed', message: 'Google did not return an identity token.' };
  }

  const auth = getAuthInstance();
  const credential = GoogleAuthProvider.credential(idToken);
  const anonymousUser = auth.currentUser;

  try {
    // The path that preserves the uid, and therefore every existing case.
    if (anonymousUser !== null && anonymousUser.isAnonymous) {
      const linked = await linkWithCredential(anonymousUser, credential);
      return { kind: 'linked', user: linked.user, uidChanged: false };
    }
    const signed = await signInWithCredential(auth, credential);
    return { kind: 'switched', user: signed.user, uidChanged: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
      // This Google account belongs to an existing uid - their real history is
      // there, and the anonymous data on this device is the throwaway copy.
      try {
        const signed = await signInWithCredential(auth, credential);
        return { kind: 'switched', user: signed.user, uidChanged: true };
      } catch (inner) {
        return {
          kind: 'failed',
          message: inner instanceof Error ? inner.message : 'Could not sign in.',
        };
      }
    }
    return { kind: 'failed', message: err instanceof Error ? err.message : 'Could not link.' };
  }
}

/**
 * Signs out of Google and drops back to a FRESH anonymous session.
 *
 * The caller must treat this as losing access to the previous uid's cases -
 * they still exist and are still that Google account's, but this device can no
 * longer read them until it signs in again. The UI has to say so before
 * calling this, not after.
 */
export async function signOutOfGoogle(): Promise<void> {
  await signOut(getAuthInstance());
}
