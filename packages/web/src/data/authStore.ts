import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

export interface AuthState {
  readonly isInitialized: boolean;
  readonly user: User | null;
  readonly error: Error | null;
  /** False when the build carried no Firebase config — see data/firebase.ts. */
  readonly isAvailable: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isInitialized: false,
    user: null,
    error: null,
    isAvailable: auth !== undefined,
  });

  useEffect(() => {
    // `auth` is undefined when Firebase was never initialised. Treat that as
    // "initialised, signed out, unavailable" rather than leaving the caller
    // stuck on a spinner forever waiting for a callback that cannot come.
    if (auth === undefined) {
      setState({ isInitialized: true, user: null, error: null, isAvailable: false });
      return;
    }
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setState({ isInitialized: true, user, error: null, isAvailable: true });
      },
      (error) => {
        setState({ isInitialized: true, user: null, error, isAvailable: true });
      },
    );
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    if (auth === undefined || googleProvider === undefined) {
      throw new Error('Sign-in is not available: this build has no Firebase configuration.');
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Google sign-in error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    if (auth === undefined) return;
    try {
      await fbSignOut(auth);
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  };

  return { ...state, signInWithGoogle, signOut };
}
