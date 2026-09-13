/**
 * A local, on-device profile — the web equivalent of the same pattern
 * already used for vitals/medications. NOT an authenticated account: there
 * is no login anywhere in this web app, no server-side user record, and
 * this store never claims otherwise. See pages/Profile.tsx for how that
 * distinction is stated to the user, per the explicit instruction not to
 * pretend authentication exists.
 */

import { useCallback, useState } from 'react';
import type { BiologicalSex } from '@triage/shared';

export interface Profile {
  readonly displayName: string;
  readonly ageYears: number;
  readonly sex: BiologicalSex;
  readonly bloodGroup: string;
  readonly allergies: string;
  readonly updatedAt: string | undefined;
}

const STORAGE_KEY = 'vitalis.profile.v1';

const EMPTY_PROFILE: Profile = {
  displayName: '',
  ageYears: 0,
  sex: 'female',
  bloodGroup: '',
  allergies: '',
  updatedAt: undefined,
};

function readStored(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? EMPTY_PROFILE : { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return EMPTY_PROFILE;
  }
}

export function useProfile(): {
  readonly profile: Profile;
  readonly save: (next: Omit<Profile, 'updatedAt'>) => void;
} {
  const [profile, setProfile] = useState<Profile>(() => readStored());

  const save = useCallback((next: Omit<Profile, 'updatedAt'>) => {
    const withStamp: Profile = { ...next, updatedAt: new Date().toISOString() };
    setProfile(withStamp);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(withStamp));
    } catch {
      // Best-effort.
    }
  }, []);

  return { profile, save };
}
