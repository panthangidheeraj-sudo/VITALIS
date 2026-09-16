/**
 * Emergency contacts — the missing piece that made Twilio look broken.
 *
 * `POST /cases/:id/confirm` has always accepted a `contacts` array and would
 * notify every one of them (see routes/cases.ts's confirmSchema and
 * notify-contacts.ts) — but nothing in packages/web ever collected a
 * contact to send. `api.confirm()` called the endpoint with `heldMs` and
 * `shareLocation: false` alone, by design (see that call site's own
 * comment: "the web app has no profile/contacts UI"). TWILIO_LIVE being
 * false is a real, separate safety default (dry-run until an operator
 * opts in) — but it was never even reached here, because there was no one
 * to notify regardless of that flag.
 *
 * Same on-device pattern as profileStore/medicationStore/vitalsStore: no
 * server-side contacts database, because there is no accounts system this
 * is attached to (see Profile.tsx's own "not an authenticated account"
 * framing) — these live in localStorage until this app grows one.
 */

import { useCallback, useEffect, useState } from 'react';

export interface EmergencyContact {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  /** E.164, e.g. +919876543210 — required by the server's own contactSchema. */
  readonly phoneE164: string;
  readonly whatsappEnabled: boolean;
  readonly smsEnabled: boolean;
  /** Can this person accept a caregiver relay request (§5.5)? Off by default —
   * turning it on is a real responsibility, not assumed from just being listed. */
  readonly canRelay: boolean;
}

const STORAGE_KEY = 'vitalis.contacts.v1';
const MAX_CONTACTS = 10; // matches confirmSchema's `contacts: z.array(...).max(10)`

/** `+`, then 7–15 digits, the first non-zero — exactly the server's own
 * `phoneE164` regex, checked here too so a bad number is caught before the
 * hold-and-release gesture rather than failing the confirm request itself. */
export const PHONE_E164_PATTERN = /^\+[1-9]\d{6,14}$/;

function isEmergencyContact(value: unknown): value is EmergencyContact {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c['id'] === 'string' &&
    typeof c['name'] === 'string' &&
    typeof c['relationship'] === 'string' &&
    typeof c['phoneE164'] === 'string' &&
    typeof c['whatsappEnabled'] === 'boolean' &&
    typeof c['smsEnabled'] === 'boolean' &&
    typeof c['canRelay'] === 'boolean'
  );
}

function readStored(): readonly EmergencyContact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    // Same reasoning as chatHistoryStore's `isChatSession` guard: a
    // malformed entry (an older shape, a partial write) is dropped rather
    // than cast, since this is read inside render-path hooks and a throw
    // here would take the Settings page down with it.
    return Array.isArray(parsed) ? parsed.filter(isEmergencyContact) : [];
  } catch {
    return [];
  }
}

function writeStored(contacts: readonly EmergencyContact[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  } catch {
    // Best-effort, same as every other store in this folder — the in-memory
    // list (React state) stays correct for this session either way.
  }
}

export function useContacts() {
  const [contacts, setContacts] = useState<readonly EmergencyContact[]>(readStored);

  useEffect(() => {
    writeStored(contacts);
  }, [contacts]);

  const add = useCallback((input: Omit<EmergencyContact, 'id'>) => {
    setContacts((prev) =>
      prev.length >= MAX_CONTACTS
        ? prev
        : [...prev, { ...input, id: `contact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }],
    );
  }, []);

  const remove = useCallback((id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { contacts, add, remove, atLimit: contacts.length >= MAX_CONTACTS };
}
