/**
 * The routing policy. Pure functions, no I/O, no model calls, no randomness.
 *
 * Spec §2 claims: "Routing decision is checked against scoring thresholds
 * before being shown." That claim is only true if the check is something a
 * reader can execute in their head and a test can pin down — so it lives here,
 * as total functions over closed enums, and the orchestrator is not permitted
 * to route by any other means.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE INVARIANT THIS FILE EXISTS TO ENFORCE (§8):
 *
 *   Tone adapts. Rigor does not.
 *
 * Not one function below accepts a `CommunicationState`. A panicked user and a
 * calm user get identical tiers, identical allowed outcomes and identical
 * gates — the difference is confined to wording, which is `communication.ts`'s
 * job. This is enforced by signature, so softening a gate for a distressed user
 * is not a judgement call someone can make under demo pressure; it is a type
 * error. `policy-invariants.test.ts` asserts it independently.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { ConfidenceLevel, ConfidenceState } from '../types/confidence.js';
import { unresolvedContradictions } from '../types/confidence.js';
import type { RiskAssessment, RiskTier, TriageLevel } from '../types/risk.js';
import { RISK_TIER_RANK } from '../types/risk.js';
import type { GateKind, RoutingOutcome, SafetyGate } from '../types/routing.js';
import { PRESS_AND_HOLD_DURATION_MS, ROUTING_OUTCOME_RANK } from '../types/routing.js';

// ---------------------------------------------------------------------------
// 1. Triage level → risk tier
// ---------------------------------------------------------------------------

/**
 * Infermedica returns five levels; the UI shows three tiers. Flagged spec
 * correction: §6 lists `serious / emergency / emergency_ambulance` as the
 * triage levels. `serious` is not a level — it is a separate array of flagged
 * evidence (see `SeriousFlag`). The real level set is the five below.
 */
export const TRIAGE_LEVEL_TO_TIER: Record<TriageLevel, RiskTier> = {
  emergency_ambulance: 'red',
  emergency: 'red',
  // Orange splits what used to be one yellow band: "be seen within 24 hours"
  // is a different instruction from "book an appointment", and a patient acts
  // on them differently.
  consultation_24: 'orange',
  consultation: 'yellow',
  self_care: 'green',
};

export function tierFor(level: TriageLevel): RiskTier {
  return TRIAGE_LEVEL_TO_TIER[level];
}

// ---------------------------------------------------------------------------
// 2. When is there enough evidence to score?
// ---------------------------------------------------------------------------

/**
 * The problem statement asks the agent to minimise unnecessary questioning, so
 * the bar to call the scorer is deliberately low — two pieces of active
 * evidence. Calling `/triage` early and often is what makes the tier move
 * *during* the interview (§5.1) instead of appearing once at the end.
 */
export const MIN_EVIDENCE_TO_SCORE = 2;

/**
 * Hard ceiling on questions. Past this the agent stops interrogating and
 * commits — escalating if it still cannot resolve. Prevents the failure mode
 * where an agent asks forever rather than admitting uncertainty.
 */
export const MAX_INTERVIEW_TURNS = 12;

export function readyToScore(activeEvidenceCount: number): boolean {
  return activeEvidenceCount >= MIN_EVIDENCE_TO_SCORE;
}

// ---------------------------------------------------------------------------
// 3. Base outcome from the clinical engine alone
// ---------------------------------------------------------------------------

/** Direct, unadjusted mapping. Confidence has not been applied yet. */
export const BASE_OUTCOME_BY_LEVEL: Record<TriageLevel, RoutingOutcome> = {
  emergency_ambulance: 'ambulance_dispatch',
  emergency: 'er_self_transport',
  consultation_24: 'urgent_care_now',
  consultation: 'primary_care_24h',
  self_care: 'self_care_guidance',
};

// ---------------------------------------------------------------------------
// 4. May the agent finalise a routing decision at all?
// ---------------------------------------------------------------------------

export interface RoutingBlock {
  readonly blocked: true;
  readonly reason:
    | 'confidence_alert_active'
    | 'unresolved_contradiction'
    | 'insufficient_evidence';
  /** What the agent must do instead. */
  readonly requiredAction: 'probe_contradiction' | 'ask_question';
  readonly explanation: string;
}

export type RoutingGateCheck = RoutingBlock | { readonly blocked: false };

/**
 * §5.1: a Confidence Alert "forces the agent to ask different, harder-to-deflect
 * follow-up questions before any routing decision or action is finalized".
 *
 * So an active alert does not *downgrade* the recommendation — it forbids
 * producing one. The agent keeps interviewing. Only when it runs out of turns
 * (see `mustEscalateUnresolved`) does it hand off to a human.
 */
export function canFinalizeRouting(input: {
  readonly confidence: Pick<ConfidenceState, 'alertActive' | 'contradictions'>;
  readonly activeEvidenceCount: number;
}): RoutingGateCheck {
  if (input.confidence.alertActive) {
    return {
      blocked: true,
      reason: 'confidence_alert_active',
      requiredAction: 'probe_contradiction',
      explanation:
        'Confidence alert is active. Reported information conflicts with other ' +
        'signals on record; re-question before any routing decision is finalised.',
    };
  }
  const unresolved = unresolvedContradictions(input.confidence);
  if (unresolved.length > 0) {
    return {
      blocked: true,
      reason: 'unresolved_contradiction',
      requiredAction: 'probe_contradiction',
      explanation: `${unresolved.length} unresolved contradiction(s) on record: ${unresolved
        .map((c) => c.kind)
        .join(', ')}.`,
    };
  }
  if (!readyToScore(input.activeEvidenceCount)) {
    return {
      blocked: true,
      reason: 'insufficient_evidence',
      requiredAction: 'ask_question',
      explanation: `Only ${input.activeEvidenceCount} evidence item(s); ${MIN_EVIDENCE_TO_SCORE} required before scoring.`,
    };
  }
  return { blocked: false };
}

/**
 * The problem statement's explicit requirement: "Escalate unresolved high-risk
 * cases rather than inventing certainty."
 *
 * Escalation is a success state, not an error. It fires when the agent has run
 * out of ways to resolve the uncertainty and the stakes are high enough that
 * guessing is the worse option.
 */
export function mustEscalateUnresolved(input: {
  readonly tier: RiskTier;
  readonly confidenceLevel: ConfidenceLevel;
  readonly unresolvedContradictionCount: number;
  readonly turnCount: number;
  readonly patientResponsive: boolean;
  readonly clinicalScoringDegraded: boolean;
}): { readonly escalate: boolean; readonly reason?: string } {
  const highRisk = RISK_TIER_RANK[input.tier] >= RISK_TIER_RANK.yellow;

  if (highRisk && !input.patientResponsive) {
    return {
      escalate: true,
      reason: 'Patient stopped responding while risk was elevated.',
    };
  }
  if (input.tier === 'red' && input.confidenceLevel === 'low') {
    return {
      escalate: true,
      reason:
        'Risk is high but the information supporting it is unreliable. ' +
        'Escalating rather than selecting a specific routing outcome on weak evidence.',
    };
  }
  if (highRisk && input.unresolvedContradictionCount > 0 && input.turnCount >= MAX_INTERVIEW_TURNS) {
    return {
      escalate: true,
      reason:
        'Contradictory information could not be resolved within the interview limit ' +
        'on an elevated-risk case.',
    };
  }
  if (input.tier === 'red' && input.clinicalScoringDegraded) {
    return {
      escalate: true,
      reason:
        'Clinical scoring engine unavailable on a high-risk case. ' +
        'Escalating rather than acting on a fallback classification.',
    };
  }
  return { escalate: false };
}

// ---------------------------------------------------------------------------
// 5. Which outcomes are permissible for a given assessment?
// ---------------------------------------------------------------------------

/**
 * The allow-list the final decision is checked against before display.
 *
 * The rule that matters most: **routing never goes DOWN on weak information.**
 * Low confidence can only make the recommendation more cautious, never less.
 * So a Red tier can never reach `self_care_guidance` regardless of what any
 * model proposes — `allowedRoutingOutcomes('red', …)` simply does not contain
 * it, and `verifyDecision` rejects anything outside the set.
 */
export function allowedRoutingOutcomes(
  tier: RiskTier,
  confidenceLevel: ConfidenceLevel,
): readonly RoutingOutcome[] {
  // Escalation is always permissible: refusing to guess is never wrong.
  const escalate: RoutingOutcome = 'escalate_human_unresolved';

  switch (tier) {
    case 'red':
      return confidenceLevel === 'low'
        ? [escalate]
        : ['ambulance_dispatch', 'er_self_transport', escalate];

    case 'orange':
      // Urgent, but ambulance is not indicated. Low confidence removes the
      // gentlest option - do not send someone home on information we do not
      // trust. Ambulance is deliberately absent here: an orange case that
      // genuinely needs one should have been scored red.
      return confidenceLevel === 'low'
        ? ['urgent_care_now', 'er_self_transport', escalate]
        : ['primary_care_24h', 'urgent_care_now', 'er_self_transport', escalate];

    case 'yellow':
      return confidenceLevel === 'low'
        ? ['primary_care_24h', 'urgent_care_now', escalate]
        : ['self_care_guidance', 'primary_care_24h', 'urgent_care_now', escalate];

    case 'green':
      return confidenceLevel === 'low'
        ? ['primary_care_24h', 'urgent_care_now', escalate]
        : ['self_care_guidance', 'primary_care_24h', escalate];
  }
}

/**
 * The recommendation itself: start from what the clinical engine said, then
 * adjust upward only.
 */
export function recommendOutcome(input: {
  readonly assessment: Pick<RiskAssessment, 'tier' | 'triageLevel' | 'source'>;
  readonly confidenceLevel: ConfidenceLevel;
  readonly escalation: { readonly escalate: boolean; readonly reason?: string };
}): { readonly outcome: RoutingOutcome; readonly policyRule: string } {
  if (input.escalation.escalate) {
    return {
      outcome: 'escalate_human_unresolved',
      policyRule: 'mustEscalateUnresolved',
    };
  }

  const base = BASE_OUTCOME_BY_LEVEL[input.assessment.triageLevel];
  const allowed = allowedRoutingOutcomes(input.assessment.tier, input.confidenceLevel);

  if (allowed.includes(base)) {
    // A degraded score never gets the benefit of the doubt: if the local
    // fallback produced this tier, step up one notch where an option exists.
    if (input.assessment.source === 'local_fallback') {
      const stepped = nextMoreCautious(base, allowed);
      if (stepped !== base) {
        return {
          outcome: stepped,
          policyRule: 'conservativeStepUp:degradedScoring',
        };
      }
    }
    return { outcome: base, policyRule: 'baseOutcomeByTriageLevel' };
  }

  // Base outcome is not permitted at this confidence — take the most cautious
  // concrete option available rather than the most convenient one.
  const fallback = mostCautious(allowed);
  return { outcome: fallback, policyRule: 'confidenceFloor:baseOutcomeDisallowed' };
}

function nextMoreCautious(
  current: RoutingOutcome,
  allowed: readonly RoutingOutcome[],
): RoutingOutcome {
  const currentRank = ROUTING_OUTCOME_RANK[current];
  const candidates = allowed
    // Never auto-step into escalation; that is `mustEscalateUnresolved`'s call.
    .filter((o) => o !== 'escalate_human_unresolved')
    .filter((o) => ROUTING_OUTCOME_RANK[o] > currentRank)
    .sort((a, b) => ROUTING_OUTCOME_RANK[a] - ROUTING_OUTCOME_RANK[b]);
  return candidates[0] ?? current;
}

function mostCautious(allowed: readonly RoutingOutcome[]): RoutingOutcome {
  const sorted = [...allowed].sort(
    (a, b) => ROUTING_OUTCOME_RANK[b] - ROUTING_OUTCOME_RANK[a],
  );
  return sorted[0] ?? 'escalate_human_unresolved';
}

// ---------------------------------------------------------------------------
// 6. Safety gates
// ---------------------------------------------------------------------------

/**
 * §5.2, non-negotiable: press-and-hold for 3 seconds before any emergency call
 * is placed. Never auto-call on a single tap — this exists because of
 * accidental-trigger risk, children included.
 *
 * Depends on the outcome and nothing else. Not on tier, not on urgency, and
 * emphatically not on communication state.
 */
export const GATE_BY_OUTCOME: Record<RoutingOutcome, GateKind> = {
  ambulance_dispatch: 'press_and_hold_3s',
  escalate_human_unresolved: 'explicit_confirm',
  er_self_transport: 'explicit_confirm',
  urgent_care_now: 'explicit_confirm',
  primary_care_24h: 'none',
  self_care_guidance: 'none',
};

const CONSEQUENCE_STATEMENTS: Record<RoutingOutcome, string> = {
  ambulance_dispatch:
    'This will request an ambulance and share your live location with emergency ' +
    'contacts. Hold the button for 3 seconds to confirm.',
  escalate_human_unresolved:
    'This will hand your case to a human responder along with everything recorded ' +
    'so far, and notify your emergency contacts. Confirm?',
  er_self_transport:
    'This will match you to an emergency department, send your details ahead, and ' +
    'notify your emergency contacts. Confirm?',
  urgent_care_now:
    'This will match you to an urgent care facility and share your case summary. Confirm?',
  primary_care_24h: 'Guidance only — no alert will be sent and no contacts notified.',
  self_care_guidance: 'Guidance only — no alert will be sent and no contacts notified.',
};

export function requiredGate(outcome: RoutingOutcome): SafetyGate {
  const kind = GATE_BY_OUTCOME[outcome];
  const base = {
    kind,
    state: kind === 'none' ? ('not_required' as const) : ('pending' as const),
    consequenceStatement: CONSEQUENCE_STATEMENTS[outcome],
  };
  return kind === 'press_and_hold_3s'
    ? { ...base, requiredHoldMs: PRESS_AND_HOLD_DURATION_MS }
    : base;
}

// ---------------------------------------------------------------------------
// 7. The verification gate
// ---------------------------------------------------------------------------

export type VerificationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly violations: readonly string[] };

/**
 * Last check before a decision is shown to anyone. Catches the failure mode the
 * whole architecture is built to prevent: a plausible-sounding recommendation
 * that the clinical evidence does not support.
 */
export function verifyDecision(input: {
  readonly outcome: RoutingOutcome;
  readonly gate: SafetyGate;
  readonly tier: RiskTier;
  readonly confidenceLevel: ConfidenceLevel;
  readonly unresolvedContradictionCount: number;
}): VerificationResult {
  const violations: string[] = [];

  const allowed = allowedRoutingOutcomes(input.tier, input.confidenceLevel);
  if (!allowed.includes(input.outcome)) {
    violations.push(
      `Outcome "${input.outcome}" is not permitted for tier "${input.tier}" at ` +
        `"${input.confidenceLevel}" confidence. Permitted: ${allowed.join(', ')}.`,
    );
  }

  const expectedGate = GATE_BY_OUTCOME[input.outcome];
  if (input.gate.kind !== expectedGate) {
    violations.push(
      `Outcome "${input.outcome}" requires gate "${expectedGate}", found "${input.gate.kind}".`,
    );
  }

  if (input.unresolvedContradictionCount > 0 && input.outcome !== 'escalate_human_unresolved') {
    violations.push(
      'Unresolved contradictions are on record; only escalation may be finalised.',
    );
  }

  if (input.tier === 'red' && input.outcome === 'self_care_guidance') {
    violations.push('Red tier can never route to self-care.');
  }

  return violations.length === 0 ? { valid: true } : { valid: false, violations };
}
