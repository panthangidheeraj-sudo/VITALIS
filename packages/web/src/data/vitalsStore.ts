/**
 * Manually-entered vitals, persisted in `localStorage` — the web equivalent
 * of packages/mobile/src/data/vitalsStore.ts (same field set, same "nothing
 * here is read from a connected device" honesty VitalsPanel.tsx states on
 * screen).
 */

import { useCallback, useState } from 'react';

export interface VitalsReading {
  readonly bpSys?: number;
  readonly bpDia?: number;
  readonly heartRate?: number;
  readonly spo2?: number;
  readonly glucose?: number;
  readonly loggedAt?: string;
}

const STORAGE_KEY = 'vitalis.vitals.v1';

function readStored(): VitalsReading {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? {} : (JSON.parse(raw) as VitalsReading);
  } catch {
    return {};
  }
}

export function useVitals(): {
  readonly vitals: VitalsReading;
  readonly save: (next: Omit<VitalsReading, 'loggedAt'>) => void;
} {
  const [vitals, setVitals] = useState<VitalsReading>(() => readStored());

  const save = useCallback((next: Omit<VitalsReading, 'loggedAt'>) => {
    const withStamp: VitalsReading = { ...next, loggedAt: new Date().toISOString() };
    setVitals(withStamp);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(withStamp));
    } catch {
      // Best-effort — not safety-critical.
    }
  }, []);

  return { vitals, save };
}
