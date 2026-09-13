/**
 * Manually-entered medication reminders, persisted on-device.
 *
 * Same pattern as `vitalsStore.ts`: nothing here is read from anywhere but
 * what the user typed in, stored locally, never sent anywhere.
 *
 * EACH REMINDER HAS ITS OWN SCHEDULE — 'daily' (every day, the original
 * behaviour) or 'dates' (only the specific calendar dates the user picked).
 * This is what makes the week-strip in `MedicationsPanel.tsx` a real
 * calendar rather than a decoration: a dated reminder only lights up the
 * days it is actually due.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ReminderSchedule =
  | { readonly kind: 'daily' }
  | { readonly kind: 'dates'; readonly dates: readonly string[] };

export interface MedicationReminder {
  readonly id: string;
  readonly name: string;
  /** Free-text time, e.g. "8:00 AM" — deliberately not a Date; this is a
   * routine time of day, independent of which day(s) it applies. */
  readonly at: string;
  readonly takenToday: boolean;
  readonly schedule: ReminderSchedule;
}

const STORAGE_KEY = 'triage.medications.manual.v2';

/** `YYYY-MM-DD` in local time, matching what the date fields collect. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isDueOn(reminder: MedicationReminder, date: Date): boolean {
  return reminder.schedule.kind === 'daily' || reminder.schedule.dates.includes(toDateKey(date));
}

async function readStored(): Promise<readonly MedicationReminder[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as readonly Partial<MedicationReminder>[];
    // Normalises anything written before schedules existed to 'daily', so an
    // old reminder keeps behaving exactly as it did rather than vanishing
    // from every day.
    return parsed.map((r) => ({
      id: r.id ?? `med_${Date.now()}_${Math.random()}`,
      name: r.name ?? '',
      at: r.at ?? '',
      takenToday: r.takenToday ?? false,
      schedule: r.schedule ?? { kind: 'daily' },
    }));
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
  readonly add: (name: string, at: string, schedule: ReminderSchedule) => void;
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
    (name: string, at: string, schedule: ReminderSchedule) => {
      const trimmedName = name.trim();
      const trimmedAt = at.trim();
      if (trimmedName.length === 0 || trimmedAt.length === 0) return;
      persist([
        ...reminders,
        { id: `med_${Date.now()}`, name: trimmedName, at: trimmedAt, takenToday: false, schedule },
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
