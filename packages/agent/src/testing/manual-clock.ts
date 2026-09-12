/**
 * A controllable clock for tests. Nothing in the loop calls `Date.now()` or
 * `new Date()` directly — every timestamp comes from an injected `ClockPort` —
 * so a test can advance time by an exact amount and assert on the result,
 * which is exactly what pinning the §5.4 anchor trace (7:00 -> 7:05) needs.
 */

import type { ClockPort, IsoTimestamp } from '@triage/shared';

export class ManualClock implements ClockPort {
  private currentMs: number;
  private monotonic = 0;

  constructor(startIso: IsoTimestamp = '2026-09-12T07:00:00.000Z') {
    this.currentMs = new Date(startIso).getTime();
  }

  now(): IsoTimestamp {
    return new Date(this.currentMs).toISOString();
  }

  monotonicMs(): number {
    // Advances a little on every read so latency measurements are never
    // exactly zero, without needing real wall-clock time in a test.
    this.monotonic += 1;
    return this.monotonic;
  }

  advanceSeconds(seconds: number): void {
    this.currentMs += seconds * 1000;
  }

  advanceMs(ms: number): void {
    this.currentMs += ms;
  }

  setIso(iso: IsoTimestamp): void {
    this.currentMs = new Date(iso).getTime();
  }
}
