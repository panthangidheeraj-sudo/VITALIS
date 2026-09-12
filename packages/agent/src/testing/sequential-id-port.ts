/**
 * Deterministic id generation for tests — `ev_1`, `ev_2`, ... per prefix, so
 * assertions can reference exact ids instead of matching patterns.
 */

import type { IdPort } from '@triage/shared';

export class SequentialIdPort implements IdPort {
  private counters = new Map<string, number>();

  newId(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${next}`;
  }
}
