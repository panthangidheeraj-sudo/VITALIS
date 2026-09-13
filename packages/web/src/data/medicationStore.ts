/**
 * Manually-entered medication reminders, persisted in `localStorage` — the
 * web equivalent of packages/mobile/src/data/medicationStore.ts's
 * AsyncStorage-backed store. Simplified to daily-only (the mobile version's
 * per-date scheduling was out of scope for this pass); nothing here is read
 * from anywhere but what the user typed in, and it never leaves the browser.
 */

import { useCallback, useEffect, useState } from 'react';

export interface MedicationReminder {
  readonly id: string;
  readonly name: string;
  readonly at: string;
  readonly takenToday: boolean;
}

const STORAGE_KEY = 'vitalis.medications.v1';

function readStored(): readonly MedicationReminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? [] : (JSON.parse(raw) as readonly MedicationReminder[]);
  } catch {
    return [];
  }
}

function writeStored(reminders: readonly MedicationReminder[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
  } catch {
    // Best-effort — this list is not safety-critical.
  }
}

export function useMedications(): {
  readonly reminders: readonly MedicationReminder[];
  readonly add: (name: string, at: string) => void;
  readonly remove: (id: string) => void;
  readonly toggleTaken: (id: string) => void;
} {
  const [reminders, setReminders] = useState<readonly MedicationReminder[]>(() => readStored());

  useEffect(() => {
    writeStored(reminders);
  }, [reminders]);

  const add = useCallback((name: string, at: string) => {
    const trimmedName = name.trim();
    const trimmedAt = at.trim();
    if (trimmedName.length === 0 || trimmedAt.length === 0) return;
    setReminders((prev) => [...prev, { id: `med_${Date.now()}`, name: trimmedName, at: trimmedAt, takenToday: false }]);
  }, []);

  const remove = useCallback((id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const toggleTaken = useCallback((id: string) => {
    setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, takenToday: !r.takenToday } : r)));
  }, []);

  return { reminders, add, remove, toggleTaken };
}
