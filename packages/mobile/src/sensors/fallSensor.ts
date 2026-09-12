/**
 * The device half of fall detection: subscribes to the accelerometer and feeds
 * samples into the pure state machine in `fallDetection.ts`.
 *
 * Kept separate so the detection logic stays testable in Node - importing
 * expo-sensors drags in the Expo runtime, which is why this file has no tests
 * and the file next door has all of them.
 */

import { Accelerometer } from 'expo-sensors';
import type { Subscription } from 'expo-sensors/build/Subscription';
import { FallDetector, magnitudeOf, FALL_THRESHOLDS, type FallEvent } from './fallDetection';

const SAMPLE_INTERVAL_MS = FALL_THRESHOLDS.sampleIntervalMs;

/**
 * Subscribes to the accelerometer and reports falls.
 *
 * Returns an unsubscribe function, and returns one even when the sensor is
 * unavailable - a device with no accelerometer, or a simulator - so callers
 * never have to special-case teardown.
 */
export async function startFallDetection(
  onFall: (event: FallEvent) => void,
): Promise<() => void> {
  let subscription: Subscription | undefined;
  try {
    const available = await Accelerometer.isAvailableAsync();
    if (!available) return () => undefined;

    const detector = new FallDetector({ onFall });
    Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
    subscription = Accelerometer.addListener((sample) => {
      detector.push(magnitudeOf(sample));
    });
  } catch {
    // No accelerometer, or permission refused. Fall detection is an extra
    // safety net, never the only one - the SOS button is unaffected.
    return () => undefined;
  }

  return () => {
    subscription?.remove();
    subscription = undefined;
  };
}
