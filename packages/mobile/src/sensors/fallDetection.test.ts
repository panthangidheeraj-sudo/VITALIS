/**
 * Fall detector tests.
 *
 * These feed synthetic waveforms through the state machine with a controlled
 * clock. The alternative - verifying by dropping a real phone - is a test
 * nobody runs twice, so the thresholds would drift unchecked.
 *
 * The false-positive cases matter more than the true positive. A missed fall
 * still leaves the SOS button; a spurious ambulance does not un-dispatch.
 */

import { describe, expect, it } from 'vitest';
import { FallDetector, magnitudeOf } from './fallDetection';

/** Drives the detector with an explicit clock so timing is deterministic. */
function run(samples: readonly { g: number; afterMs: number }[]): number {
  let now = 0;
  let falls = 0;
  const detector = new FallDetector({ onFall: () => (falls += 1), now: () => now });
  for (const s of samples) {
    now += s.afterMs;
    detector.push(s.g);
  }
  return falls;
}

/** Repeats a reading, e.g. to hold still for a while. */
function hold(g: number, ms: number, stepMs = 100): { g: number; afterMs: number }[] {
  return Array.from({ length: Math.ceil(ms / stepMs) }, () => ({ g, afterMs: stepMs }));
}

const REAL_FALL = [
  ...hold(1.0, 500),
  { g: 0.2, afterMs: 100 }, // free fall
  { g: 0.15, afterMs: 100 },
  { g: 3.4, afterMs: 100 }, // impact
  ...hold(1.0, 3000), // motionless afterwards
];

describe('detecting a fall', () => {
  it('fires on free fall, then impact, then stillness', () => {
    expect(run(REAL_FALL)).toBe(1);
  });

  it('reports the impact and free-fall readings that triggered it', () => {
    let captured: { impactG: number; freeFallG: number } | undefined;
    let now = 0;
    const d = new FallDetector({ onFall: (e) => (captured = e), now: () => now });
    for (const s of REAL_FALL) {
      now += s.afterMs;
      d.push(s.g);
    }
    // Surfaced so the UI can say why it fired instead of asserting magic.
    expect(captured?.impactG).toBeCloseTo(3.4);
    expect(captured?.freeFallG).toBeCloseTo(0.15);
  });
});

describe('not firing on everyday handling', () => {
  it('ignores walking', () => {
    // Brisk walking oscillates roughly 0.7g-1.6g and never approaches free fall.
    const walk = Array.from({ length: 200 }, (_, i) => ({
      g: 1 + Math.sin(i / 2) * 0.6,
      afterMs: 100,
    }));
    expect(run(walk)).toBe(0);
  });

  it('ignores a phone set down hard', () => {
    // An impact with no preceding free fall is not a fall.
    expect(run([...hold(1.0, 500), { g: 2.9, afterMs: 100 }, ...hold(1.0, 3000)])).toBe(0);
  });

  it('ignores free fall with no impact', () => {
    // e.g. a lift starting its descent.
    expect(run([...hold(1.0, 300), ...hold(0.3, 800), ...hold(1.0, 3000)])).toBe(0);
  });

  /**
   * THE CASE THAT MATTERS MOST. A dropped phone produces free fall and impact
   * exactly like a fall does. The only thing that separates them is what
   * happens next: a person picks the phone up, a fallen person does not move.
   */
  it('ignores a dropped phone that is picked back up', () => {
    expect(
      run([
        ...hold(1.0, 300),
        { g: 0.2, afterMs: 100 },
        { g: 3.1, afterMs: 100 },
        ...hold(1.0, 800), // briefly still on the floor
        ...hold(1.9, 600), // picked up - movement resumes
        ...hold(1.0, 3000),
      ]),
    ).toBe(0);
  });

  it('ignores an impact that arrives too long after the free fall', () => {
    expect(
      run([...hold(1.0, 300), { g: 0.2, afterMs: 100 }, ...hold(1.0, 2000), { g: 3.2, afterMs: 100 }, ...hold(1.0, 3000)]),
    ).toBe(0);
  });

  it('does not re-fire while the phone stays still after a detected fall', () => {
    // One fall must produce one alarm, not one per sample.
    expect(run([...REAL_FALL, ...hold(1.0, 5000)])).toBe(1);
  });
});

describe('magnitude', () => {
  it('reads 1g for a phone resting flat', () => {
    expect(magnitudeOf({ x: 0, y: 0, z: -1 })).toBeCloseTo(1);
  });

  it('is orientation-independent', () => {
    // The detector must not care which way up the phone is.
    expect(magnitudeOf({ x: 0.577, y: 0.577, z: 0.577 })).toBeCloseTo(1, 2);
  });
});
