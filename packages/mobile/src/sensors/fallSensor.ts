/**
 * The device half of fall detection: subscribes to the accelerometer and feeds
 * samples into the pure state machine in `fallDetection.ts`.
 *
 * Kept separate so the detection logic stays testable in Node - importing
 * expo-sensors drags in the Expo runtime, which is why this file has no tests
 * and the file next door has all of them.
 */

import { Accelerometer } from 'expo-sensors';
import { FallDetector, magnitudeOf, FALL_THRESHOLDS, type FallEvent } from './fallDetection';

/**
 * The subscription handle, derived from `addListener`'s own return type rather
 * than imported from `expo-sensors/build/Subscription` - that deep path is an
 * internal build artefact and is not in the package's export map, so importing
 * it typechecks on no machine at all. Deriving it cannot drift with the SDK.
 */
type AccelerometerSubscription = ReturnType<typeof Accelerometer.addListener>;

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
  let subscription: AccelerometerSubscription | undefined;
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
