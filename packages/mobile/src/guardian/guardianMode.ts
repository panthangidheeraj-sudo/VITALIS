/**
 * Guardian Mode - raises an alarm when the user stops responding.
 *
 * A dead-man's switch. During an active case the agent asks a question and
 * waits; if nothing comes back for long enough, the most likely explanations
 * are that the patient has deteriorated or lost consciousness. Spec 5.5 makes
 * "patient stops responding" the trigger for handing over to a caregiver, and
 * risk-policy.ts already escalates an unresponsive patient at elevated risk.
 * This is the client-side half that notices the silence in the first place.
 *
 * THE TIMEOUT SCALES WITH RISK, and that is the whole design:
 *
 *   Someone on a green case who puts their phone down for two minutes is
 *   probably fine. Someone on a red case who goes quiet for two minutes is an
 *   emergency. Using one timeout for both either cries wolf constantly on the
 *   calm cases or responds far too slowly on the dangerous ones.
 *
 * Like fall detection, this NEVER dispatches. It opens the same cancellable
 * countdown, and the press-and-hold gate still guards anything beyond that.
 *
 * Pure module - no timers of its own, no React, no Expo. The caller ticks it.
 * That keeps it testable and keeps the "when does this fire" decision in one
 * readable place rather than smeared across a component's effects.
 */

import type { RiskTier } from '@triage/shared';

/**
 * Silence tolerated before Guardian Mode raises the countdown, per tier.
 *
 * Red is 45 seconds rather than something shorter because the patient may
 * legitimately be reading first-aid instructions or talking to a responder.
 * Below about half a minute this fires while people are simply thinking.
 */
export const GUARDIAN_TIMEOUT_MS: Record<RiskTier, number> = {
  green: 6 * 60_000,
  yellow: 4 * 60_000,
  orange: 90_000,
  red: 45_000,
};

/** Not armed at all on a case that is finished or was stood down. */
const ACTIVE_STATUSES = ['interviewing', 'awaiting_confirmation', 'action_taken'] as const;
type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export interface GuardianInput {
  readonly status: string;
  readonly tier: RiskTier;
  /** Epoch ms of the last thing the user did - any tap, not just an answer. */
  readonly lastInteractionAtMs: number;
  readonly nowMs: number;
  /** The user can switch it off; an unwanted alarm is worse than none. */
  readonly enabled: boolean;
}

export interface GuardianVerdict {
  readonly armed: boolean;
  readonly shouldAlarm: boolean;
  readonly silentForMs: number;
  readonly timeoutMs: number;
  /** Milliseconds until the alarm, for a visible "still with you" indicator. */
  readonly remainingMs: number;
}

export function evaluateGuardian(input: GuardianInput): GuardianVerdict {
  const armed =
    input.enabled && (ACTIVE_STATUSES as readonly string[]).includes(input.status as ActiveStatus);
  const timeoutMs = GUARDIAN_TIMEOUT_MS[input.tier];
  const silentForMs = Math.max(0, input.nowMs - input.lastInteractionAtMs);

  return {
    armed,
    shouldAlarm: armed && silentForMs >= timeoutMs,
    silentForMs,
    timeoutMs,
    remainingMs: Math.max(0, timeoutMs - silentForMs),
  };
}

/**
 * Human-readable reason for the countdown screen. The user has to be able to
 * judge in one second whether the alarm is wrong, which means telling them
 * exactly what the system noticed.
 */
export function guardianReason(verdict: GuardianVerdict, tier: RiskTier): string {
  const seconds = Math.round(verdict.silentForMs / 1000);
  const phrase = seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
  return `You have not responded for ${phrase} while your risk level is ${tier.toUpperCase()}.`;
}
