/**
 * The real patient profile, persisted on-device — replaces `demoProfile.ts`.
 *
 * Everything that used to live in that file as hardcoded sample data (name,
 * age, sex, blood group, allergies, medications, emergency contacts) is now
 * something the user actually typed into ProfileScreen and that is stored
 * here, AsyncStorage-backed, same pattern as `medicationStore.ts` and
 * `vitalsStore.ts`.
 *
 * `isComplete` exists because several call sites (case creation, the
 * confirmation notify payload) need a real fallback when the user has never
 * opened the profile screen — they use `FALLBACK_DEMOGRAPHICS` in that case,
 * which is a technical default (not a persona) and is never shown on screen
 * as though it were the user's real data.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BiologicalSex } from '@triage/shared';

export interface ProfileContact {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly phone: string;
  readonly isPrimary: boolean;
}

export interface Profile {
  readonly displayName: string;
  readonly ageYears: number;
  readonly sex: BiologicalSex;
  readonly bloodGroup: string;
  readonly allergies: readonly string[];
  readonly medications: readonly string[];
  readonly chronicConditions: readonly string[];
  readonly organDonor: boolean;
  readonly notes: string;
  readonly contacts: readonly ProfileContact[];
  readonly updatedAt: string | undefined;
}

const STORAGE_KEY = 'triage.profile.v1';

const EMPTY_PROFILE: Profile = {
  displayName: '',
  ageYears: 0,
  sex: 'female',
  bloodGroup: '',
  allergies: [],
  medications: [],
  chronicConditions: [],
  organDonor: false,
  notes: '',
  contacts: [],
  updatedAt: undefined,
};

/**
 * Used only where an API call requires a number/sex and the user has not
 * filled in their profile yet — never rendered as if it were their data.
 */
export const FALLBACK_DEMOGRAPHICS = { ageYears: 30, sex: 'female' as BiologicalSex };

async function readStored(): Promise<Profile> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_PROFILE;
    return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return EMPTY_PROFILE;
  }
}

async function writeStored(profile: Profile): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Best-effort, same as the other on-device stores.
  }
}

export function useProfile(): {
  readonly profile: Profile;
  readonly loading: boolean;
  readonly isComplete: boolean;
  readonly save: (next: Omit<Profile, 'updatedAt'>) => void;
} {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readStored().then((stored) => {
      if (!cancelled) {
        setProfile(stored);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback((next: Omit<Profile, 'updatedAt'>) => {
    const withStamp: Profile = { ...next, updatedAt: new Date().toISOString() };
    setProfile(withStamp);
    void writeStored(withStamp);
  }, []);

  return {
    profile,
    loading,
    isComplete: profile.displayName.trim().length > 0 && profile.ageYears > 0,
    save,
  };
}
