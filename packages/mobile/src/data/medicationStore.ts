/**
 * Manually-entered medication reminders, persisted on-device.
 *
 * Replaces a HARDCODED two-item array ("Metformin 500 mg, TAKEN" /
 * "Amlodipine 5 mg, DUE") that rendered as a live reminder list regardless of
 * who was using the app or what they actually take — the exact kind of mock
 * data flagged for removal. Same pattern as `vitalsStore.ts`: nothing here is
 * read from anywhere but what the user typed in, stored locally, never sent
 * anywhere.
 *
 * NOT a calendar/scheduling engine. A full month-grid calendar view is a
 * meaningfully larger UI (a day-cell grid, a recurrence model, multi-day
 * navigation) than this turn had room for — this ships the list, grouped by
 * time of day, as the honest interim shape. See the follow-up note where this
 * is wired in.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MedicationReminder {
  readonly id: string;
  readonly name: string;
  /** Free-text time, e.g. "8:00 AM" — deliberately not a Date; this is a daily
   * routine time, not a one-off calendar event. */
  readonly at: string;
  readonly takenToday: boolean;
}

const STORAGE_KEY = 'triage.medications.manual.v1';

async function readStored(): Promise<readonly MedicationReminder[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    return JSON.parse(raw) as readonly MedicationReminder[];
  } catch {
    return [];
  }
}

async function writeStored(reminders: readonly MedicationReminder[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
  } catch {
    // Best-effort, same as vitalsStore — this screen is not safety-critical.
  }
}

export function useMedications(): {
  readonly reminders: readonly MedicationReminder[];
  readonly loading: boolean;
  readonly add: (name: string, at: string) => void;
  readonly remove: (id: string) => void;
  readonly toggleTaken: (id: string) => void;
} {
  const [reminders, setReminders] = useState<readonly MedicationReminder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readStored().then((stored) => {
      if (!cancelled) {
        setReminders(stored);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: readonly MedicationReminder[]) => {
    setReminders(next);
    void writeStored(next);
  }, []);

  const add = useCallback(
    (name: string, at: string) => {
      const trimmedName = name.trim();
      const trimmedAt = at.trim();
      if (trimmedName.length === 0 || trimmedAt.length === 0) return;
      persist([
        ...reminders,
        { id: `med_${Date.now()}`, name: trimmedName, at: trimmedAt, takenToday: false },
      ]);
    },
    [persist, reminders],
  );

  const remove = useCallback(
    (id: string) => persist(reminders.filter((r) => r.id !== id)),
    [persist, reminders],
  );

  const toggleTaken = useCallback(
    (id: string) =>
      persist(reminders.map((r) => (r.id === id ? { ...r, takenToday: !r.takenToday } : r))),
    [persist, reminders],
  );

  return { reminders, loading, add, remove, toggleTaken };
}
