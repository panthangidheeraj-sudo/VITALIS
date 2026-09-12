/**
 * Routing outcomes and safety gates.
 *
 * The problem statement requires the agent to "decide among predefined routing
 * outcomes" and to "escalate unresolved high-risk cases rather than inventing
 * certainty". Both are structural here: the outcome set is closed, and
 * `escalate_human_unresolved` is a first-class member of it rather than an
 * error path — the agent choosing it is a success, not a failure.
 */

import type { IsoTimestamp, Millis } from './common.js';

export const ROUTING_OUTCOMES = [
  /** Self-care guidance plus first-aid steps. Green only. */
  'self_care_guidance',
  /** See a doctor within 24 hours. */
  'primary_care_24h',
  /** Go to urgent care now, patient-transported. */
  'urgent_care_now',
  /** Go to the emergency department now, patient-transported. */
  'er_self_transport',
  /** Dispatch an ambulance. Always gated behind press-and-hold (§5.2). */
  'ambulance_dispatch',
  /**
   * The honest answer. Risk is high, the information is not trustworthy enough
   * to pick between the options above, and the agent refuses to guess. Hands
   * off to a human with everything it has. Required by the problem statement.
   */
  'escalate_human_unresolved',
] as const;
export type RoutingOutcome = (typeof ROUTING_OUTCOMES)[number];

/** Rough severity ordering, used to check the agent never routes *down* on escalation. */
export const ROUTING_OUTCOME_RANK: Record<RoutingOutcome, number> = {
  self_care_guidance: 0,
  primary_care_24h: 1,
  urgent_care_now: 2,
  er_self_transport: 3,
  ambulance_dispatch: 4,
  // Ranked at the top: an unresolved high-risk case is treated as at least as
  // serious as the most serious concrete action, never as a soft fallback.
  escalate_human_unresolved: 5,
};

export const ROUTING_OUTCOME_LABELS: Record<RoutingOutcome, string> = {
  self_care_guidance: 'Self-care at home',
  primary_care_24h: 'See a doctor within 24 hours',
  urgent_care_now: 'Go to urgent care now',
  er_self_transport: 'Go to the emergency department now',
  ambulance_dispatch: 'Emergency ambulance',
  escalate_human_unresolved: 'Escalated to a human responder — unresolved',
};

// --- Safety gates ------------------------------------------------------------

/**
 * §5.2, explicitly non-negotiable: no emergency call is ever placed on a single
 * tap. The press-and-hold exists because of accidental-trigger risk, children
 * included.
 */
export type GateKind =
  /** Continuous 3-second hold. Required for anything that dispatches or calls. */
  | 'press_and_hold_3s'
  /** A deliberate confirm tap on a full-screen prompt. */
  | 'explicit_confirm'
  /** No gate — informational outcomes only. */
  | 'none';

export const PRESS_AND_HOLD_DURATION_MS: Millis = 3000;

export type GateState = 'not_required' | 'pending' | 'satisfied' | 'cancelled';

export interface SafetyGate {
  readonly kind: GateKind;
  readonly state: GateState;
  /** Human-readable statement of consequences, shown before the gate (§7). */
  readonly consequenceStatement: string;
  readonly requiredHoldMs?: Millis;
  readonly satisfiedAt?: IsoTimestamp;
  readonly cancelledAt?: IsoTimestamp;
}

// --- The decision ------------------------------------------------------------

export interface RoutingDecision {
  readonly outcome: RoutingOutcome;
  /**
   * Plain-language justification traced to the risk assessment. Written by
   * Groq, but only ever describing a decision the deterministic policy already
   * made — never selecting it.
   */
  readonly rationale: string;
  /** Which policy rule produced this, for the reasoning panel and tests. */
  readonly policyRule: string;
  readonly gate: SafetyGate;

  /** Proposed by the policy but not yet confirmed by the user. */
  readonly proposedAt: IsoTimestamp;
  /** Set once the gate is satisfied and the action actually fired. */
  readonly confirmedAt?: IsoTimestamp;
  /** §5.2: "Cancel Alert" is always available during live tracking. */
  readonly cancelledAt?: IsoTimestamp;

  /** The assessment this decision was checked against, for auditability. */
  readonly basedOnRiskComputedAt: IsoTimestamp;
}

/** Outcomes that trigger an irreversible, outward-facing action. */
export function isConsequentialOutcome(outcome: RoutingOutcome): boolean {
  return outcome === 'ambulance_dispatch' || outcome === 'escalate_human_unresolved';
}

// --- Dispatch tracking (§5.2 live tracking screen) ---------------------------

export type DispatchStatus =
  | 'not_dispatched'
  | 'dispatch_requested'
  | 'en_route'
  | 'arrived'
  | 'cancelled';

export interface DispatchState {
  readonly status: DispatchStatus;
  /** Simulated in this build — there is no real ambulance network to call. */
  readonly simulated: true;
  readonly requestedAt?: IsoTimestamp;
  readonly etaMinutes?: number;
  readonly contactNumber?: string;
  readonly unitLabel?: string;
  readonly cancelledAt?: IsoTimestamp;
  readonly cancelledBy?: 'patient' | 'caregiver' | 'system';
}
