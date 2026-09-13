/**
 * Manually-entered vitals, persisted on-device.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: the Home screen originally showed blood pressure, heart
 * rate, SpO2 and glucose as an animated bar chart, a live-drawn ECG trace and
 * a filling ring — the visual language of a wearable streaming readings over
 * Bluetooth. There is no wearable integration in this build and there was
 * never a plan for one; the numbers were the design's own sample data,
 * animated to look live. That is the wrong thing to show on a page whose
 * numbers are meant to inform a real decision — a plausible vital sign with
 * no real source is the single most misleading thing this screen could do.
 *
 * So: no device, no Bluetooth, no simulated streaming. Every value here is
 * something a person read off a home BP cuff, a glucometer, a pulse oximeter,
 * or their own pulse count, and typed in — the same information they would
 * otherwise write on a paper chart. Stored locally with AsyncStorage (the same
 * mechanism `offline/firstAidStore.ts` uses), never sent anywhere, and shown
 * with the time it was entered rather than implied to be "now."
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface VitalsReading {
  readonly bpSys?: number;
  readonly bpDia?: number;
  readonly heartRate?: number;
  readonly spo2?: number;
  readonly glucose?: number;
  /** ISO timestamp of the last edit. Absent until the first save. */
  readonly loggedAt?: string;
}

const STORAGE_KEY = 'triage.vitals.manual.v1';

async function readStored(): Promise<VitalsReading> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    return JSON.parse(raw) as VitalsReading;
  } catch {
    // A corrupted or unavailable store degrades to "nothing logged yet," not
    // to a crash — this screen is not on any safety-critical path.
    return {};
  }
}

async function writeStored(reading: VitalsReading): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reading));
  } catch {
    // Best-effort. The in-memory state the hook holds is still correct for
    // this session even if the write fails.
  }
}

/**
 * Loads the saved reading and exposes a setter that updates state and
 * persists in one call, so no screen has to remember to do both.
 */
export function useVitals(): {
  readonly vitals: VitalsReading;
  readonly loading: boolean;
  readonly save: (next: VitalsReading) => void;
} {
  const [vitals, setVitals] = useState<VitalsReading>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readStored().then((stored) => {
      if (!cancelled) {
        setVitals(stored);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback((next: VitalsReading) => {
    const withTimestamp: VitalsReading = { ...next, loggedAt: new Date().toISOString() };
    setVitals(withTimestamp);
    void writeStored(withTimestamp);
  }, []);

  return { vitals, loading, save };
}
