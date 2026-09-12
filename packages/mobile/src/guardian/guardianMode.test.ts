/**
 * Guardian Mode tests.
 *
 * The risk-scaled timeout is the thing worth protecting: a single timeout
 * either cries wolf on calm cases or responds far too slowly on dangerous
 * ones, and a later "simplification" to one constant would look harmless.
 */

import { describe, expect, it } from 'vitest';
import { GUARDIAN_TIMEOUT_MS, evaluateGuardian, guardianReason } from './guardianMode';

const BASE = { enabled: true, status: 'interviewing', nowMs: 1_000_000 };

function silentFor(ms: number, tier: 'green' | 'yellow' | 'orange' | 'red') {
  return evaluateGuardian({ ...BASE, tier, lastInteractionAtMs: BASE.nowMs - ms });
}

describe('the timeout scales with risk', () => {
  it('tolerates far less silence as the tier rises', () => {
    // Strictly decreasing. This ordering IS the feature.
    expect(GUARDIAN_TIMEOUT_MS.green).toBeGreaterThan(GUARDIAN_TIMEOUT_MS.yellow);
    expect(GUARDIAN_TIMEOUT_MS.yellow).toBeGreaterThan(GUARDIAN_TIMEOUT_MS.orange);
    expect(GUARDIAN_TIMEOUT_MS.orange).toBeGreaterThan(GUARDIAN_TIMEOUT_MS.red);
  });

  it('alarms on a red case where a green case would still be waiting', () => {
    const ms = 60_000;
    expect(silentFor(ms, 'red').shouldAlarm).toBe(true);
    expect(silentFor(ms, 'green').shouldAlarm).toBe(false);
  });

  /**
   * Below roughly half a minute this fires while people are simply thinking,
   * or reading the first-aid steps the app itself just told them to read.
   */
  it('gives even a red case time to read an instruction', () => {
    expect(GUARDIAN_TIMEOUT_MS.red).toBeGreaterThanOrEqual(30_000);
  });
});

describe('when it is armed', () => {
  it('stays disarmed once the case is closed', () => {
    for (const status of ['resolved', 'cancelled', 'escalated']) {
      const v = evaluateGuardian({ ...BASE, status, tier: 'red', lastInteractionAtMs: 0 });
      expect(v.armed, `${status} must not arm Guardian`).toBe(false);
      expect(v.shouldAlarm).toBe(false);
    }
  });

  it('stays disarmed when the user has switched it off', () => {
    const v = evaluateGuardian({ ...BASE, enabled: false, tier: 'red', lastInteractionAtMs: 0 });
    // An unwanted alarm is worse than no alarm: it gets the feature disabled.
    expect(v.shouldAlarm).toBe(false);
  });

  it('arms during an active case', () => {
    for (const status of ['interviewing', 'awaiting_confirmation', 'action_taken']) {
      expect(evaluateGuardian({ ...BASE, status, tier: 'red', lastInteractionAtMs: BASE.nowMs }).armed).toBe(true);
    }
  });
});

describe('countdown reporting', () => {
  it('reports remaining time so the UI can show it is still watching', () => {
    const v = silentFor(15_000, 'red');
    expect(v.remainingMs).toBe(GUARDIAN_TIMEOUT_MS.red - 15_000);
    expect(v.shouldAlarm).toBe(false);
  });

  it('never reports negative time once overdue', () => {
    expect(silentFor(999_999, 'red').remainingMs).toBe(0);
  });

  it('survives a clock that jumps backwards', () => {
    // Device clocks do move backwards (NTP sync, manual change). Treating that
    // as a huge silence would fire the alarm for no reason.
    const v = evaluateGuardian({ ...BASE, tier: 'red', lastInteractionAtMs: BASE.nowMs + 10_000 });
    expect(v.silentForMs).toBe(0);
    expect(v.shouldAlarm).toBe(false);
  });

  it('says exactly what it noticed', () => {
    // The user must be able to judge in one second whether this is wrong.
    expect(guardianReason(silentFor(45_000, 'red'), 'red')).toContain('45 seconds');
    expect(guardianReason(silentFor(240_000, 'green'), 'green')).toContain('4 minutes');
  });
});
