/**
 * Fall detection from the phone's accelerometer.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE TUNING ANY NUMBER IN THIS FILE
 *
 * A fall detector has two failure modes and they are NOT symmetric:
 *
 *   FALSE NEGATIVE - someone fell and we missed it. Bad, but the app is not
 *   their only safety net: the SOS button still exists and is one tap away.
 *
 *   FALSE POSITIVE - the phone slid off a table and we called an ambulance.
 *   This is far worse. It wastes a real emergency vehicle, and after it
 *   happens once the user turns the feature off, which costs them the true
 *   positives too.
 *
 * So this is deliberately CONSERVATIVE, and - the important part - detection
 * never dispatches anything. It only opens a countdown the user can cancel.
 * The 3-second press-and-hold gate still stands between the countdown and any
 * ambulance. Nothing here bypasses it.
 * ---------------------------------------------------------------------------
 *
 * THE PATTERN, in the order a real fall produces it:
 *
 *   1. FREE FALL      magnitude drops well below 1g as the body accelerates
 *                     downward. A phone at rest reads ~1g; in free fall it
 *                     approaches 0g.
 *   2. IMPACT         a sharp spike well above 1g when the body hits.
 *   3. STILLNESS      the phone stops moving. This is the step that separates
 *                     a fall from a dropped phone that gets picked straight
 *                     back up, and it is why the detector waits before firing.
 *
 * All three, in that order, inside a short window. Requiring the sequence
 * rather than a single threshold is what keeps a hard sit-down or a phone
 * tossed onto a sofa from triggering it.
 *
 * Values are in g (multiples of gravity); expo-sensors reports in g already.
 *
 * THIS FILE IMPORTS NOTHING FROM EXPO, deliberately. The state machine is pure
 * so it can be tested in plain Node against synthetic waveforms; the
 * accelerometer subscription lives in `fallSensor.ts` next door. Same reason
 * the agent depends on ports rather than SDKs.
 */

/** Below this, the phone is accelerating downward - not merely tilted. */
const FREE_FALL_G = 0.45;

/**
 * Impact threshold. A brisk walk peaks around 1.5g and setting a phone down
 * hard reaches ~2g, so 2.6g sits above normal handling without demanding a
 * violent fall.
 */
const IMPACT_G = 2.6;

/** Free fall must be followed by impact within this long, or it was not a fall. */
const FREE_FALL_TO_IMPACT_MS = 1200;

/** How close to 1g counts as "not moving". */
const STILLNESS_TOLERANCE_G = 0.18;

/**
 * How long the phone must stay still after impact. Long enough that picking a
 * dropped phone straight back up cancels it; short enough that someone who is
 * actually hurt is not left waiting.
 */
const STILLNESS_REQUIRED_MS = 2500;

/**
 * Grace period straight after impact, during which movement is ignored.
 * A body and phone bounce and settle; treating that settle as "they moved"
 * would abort almost every real fall.
 */
const SETTLE_MS = 600;

/** 100ms. Faster burns battery for no accuracy gain at these thresholds. */
const SAMPLE_INTERVAL_MS = 100;

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'free_fall'; readonly atMs: number }
  | { readonly kind: 'impact'; readonly atMs: number; readonly stillSinceMs: number | undefined };

export interface FallEvent {
  readonly detectedAtMs: number;
  /** Peak g recorded at impact. Shown to the user so the trigger is legible. */
  readonly impactG: number;
  readonly freeFallG: number;
}

export interface FallDetectorOptions {
  readonly onFall: (event: FallEvent) => void;
  /** Injectable for tests; defaults to Date.now. */
  readonly now?: () => number;
}

/**
 * Runs the state machine over a stream of accelerometer samples.
 *
 * Separated from the Accelerometer subscription so the detection logic can be
 * tested by feeding it a synthetic waveform, with no device and no mocking of
 * a native module. A detector that can only be verified by dropping a real
 * phone is a detector nobody verifies.
 */
export class FallDetector {
  private phase: Phase = { kind: 'idle' };
  private freeFallG = 1;
  private impactG = 0;

  constructor(private readonly options: FallDetectorOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  reset(): void {
    this.phase = { kind: 'idle' };
    this.freeFallG = 1;
    this.impactG = 0;
  }

  /** Feed one sample. `magnitude` is the vector length of (x, y, z) in g. */
  push(magnitude: number): void {
    const t = this.now();

    switch (this.phase.kind) {
      case 'idle':
        if (magnitude < FREE_FALL_G) {
          this.freeFallG = magnitude;
          this.phase = { kind: 'free_fall', atMs: t };
        }
        return;


      case 'free_fall':
        // The impact has to arrive promptly. A long gap means the low reading
        // was something else - a phone held in a lift, say.
        if (t - this.phase.atMs > FREE_FALL_TO_IMPACT_MS) {
          this.reset();
          return;
        }
        // Keep the LOWEST reading seen while falling - the deepest point of
        // the free fall describes the event better than its first sample.
        if (magnitude < this.freeFallG) this.freeFallG = magnitude;
        if (magnitude > IMPACT_G) {
          this.impactG = magnitude;
          this.phase = { kind: 'impact', atMs: t, stillSinceMs: undefined };
        }
        return;

      case 'impact': {
        const still = Math.abs(magnitude - 1) < STILLNESS_TOLERANCE_G;
        if (!still) {
          // Purposeful movement after impact ABANDONS the candidate entirely -
          // it does not merely restart the stillness timer. Someone who picks
          // their dropped phone up, or gets themselves back up, is fine. An
          // earlier version only reset the timer, so the phone being set down
          // again later still fired the alarm: a dropped phone became an
          // ambulance. A test covers exactly that sequence now.
          if (t - this.phase.atMs > SETTLE_MS) this.reset();
          return;
        }
        const since = this.phase.stillSinceMs ?? t;
        if (t - since >= STILLNESS_REQUIRED_MS) {
          const event: FallEvent = {
            detectedAtMs: t,
            impactG: this.impactG,
            freeFallG: this.freeFallG,
          };
          this.reset();
          this.options.onFall(event);
          return;
        }
        this.phase = { kind: 'impact', atMs: this.phase.atMs, stillSinceMs: since };
        return;
      }
    }
  }
}

export function magnitudeOf(sample: { x: number; y: number; z: number }): number {
  return Math.sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z);
}

/** Exposed so the UI can explain the thresholds rather than assert magic. */
export const FALL_THRESHOLDS = {
  freeFallG: FREE_FALL_G,
  impactG: IMPACT_G,
  stillnessSeconds: STILLNESS_REQUIRED_MS / 1000,
  sampleIntervalMs: SAMPLE_INTERVAL_MS,
} as const;
