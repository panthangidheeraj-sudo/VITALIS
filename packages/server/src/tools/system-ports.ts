/**
 * Production `ClockPort` and `IdPort`.
 *
 * These exist as injected ports rather than bare `Date.now()` / `randomUUID()`
 * calls scattered through the loop specifically so the test harness can swap in
 * `ManualClock` and `SequentialIdPort` and replay the §5.4 escalation trace
 * (7:00 → 7:05) deterministically. The loop never learns which it is talking to.
 */

import { randomUUID } from 'node:crypto';
import type { ClockPort, IdPort, IsoTimestamp } from '@triage/shared';

export class SystemClock implements ClockPort {
  now(): IsoTimestamp {
    return new Date().toISOString();
  }

  monotonicMs(): number {
    // performance.now() rather than Date.now(): immune to NTP corrections and
    // clock drift, which matters because this value is only ever used for
    // latency deltas in the tool ledger.
    return performance.now();
  }
}

export class UuidIdPort implements IdPort {
  newId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}
