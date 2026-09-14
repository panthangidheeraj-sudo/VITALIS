import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

export interface AuthState {
  readonly isInitialized: boolean;
  readonly user: User | null;
  readonly error: Error | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isInitialized: false,
    user: null,
    error: null,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setState({ isInitialized: true, user, error: null });
      },
      (error) => {
        setState({ isInitialized: true, user: null, error });
      }
    );
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Google sign-in error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await fbSignOut(auth);
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  };

  return { ...state, signInWithGoogle, signOut };
}
