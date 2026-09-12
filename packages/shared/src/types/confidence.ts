/**
 * Confidence — axis two (spec §2), and the headline innovation.
 *
 * Risk answers "how bad is this?". Confidence answers "how much should I
 * believe what I'm being told?". Tracking them separately is the whole point:
 * a LOW-confidence GREEN is not a green light, it is a reason to ask harder
 * questions. A plain chatbot collapses these into one number and therefore
 * cannot represent "the patient says they're fine and I don't buy it".
 */

import type { EvidenceId, IsoTimestamp, TurnId } from './common.js';

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Thresholds on the 0..1 score. Single source of truth for the banding. */
export const CONFIDENCE_THRESHOLDS = {
  /** At or above this, information is treated as reliable. */
  high: 0.75,
  /** At or above this, usable but worth probing. */
  medium: 0.45,
} as const;

export function confidenceLevelFor(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/**
 * Categories of contradiction the agent watches for. Each maps to a different
 * re-questioning strategy, which is why this is an enum and not a boolean.
 */
export type ContradictionKind =
  /**
   * The spec's defining example (§2): the patient asserts they are fine while
   * another signal on record says otherwise — a reported hard fall, a quick-
   * select tag they themselves picked, an injury photo showing active bleeding.
   */
  | 'self_report_vs_evidence'
  /** The same concept answered differently across two turns. */
  | 'cross_turn_reversal'
  /** A stated symptom is incompatible with a measured vital. */
  | 'vital_vs_statement'
  /** Stated timing conflicts with the recorded timeline ("it just started" at minute 12). */
  | 'timeline_inconsistency'
  /** Patient and caregiver disagree during Family Relay Mode (§5.5). */
  | 'caregiver_vs_patient';

export interface Contradiction {
  readonly kind: ContradictionKind;
  /** Machine-readable summary of the conflict, for the timeline and the ledger. */
  readonly detail: string;
  /** Evidence items that disagree. At least two. */
  readonly conflictingEvidenceIds: readonly EvidenceId[];
  readonly priorTurnId?: TurnId;
  readonly currentTurnId?: TurnId;
  readonly detectedAt: IsoTimestamp;
  /**
   * Cleared once the agent has asked a follow-up that resolves the conflict.
   * An unresolved contradiction on a high-risk case forces
   * `escalate_human_unresolved` rather than a confident routing decision.
   */
  readonly resolvedAt?: IsoTimestamp;
  readonly resolutionNote?: string;
}

/** Why confidence is where it is. Shown in the "system shows its reasoning" panel (§9). */
export type ConfidenceReasonCode =
  | 'sparse_evidence'
  | 'terse_answers'
  | 'self_contradiction'
  | 'vague_or_uncertain_answers'
  | 'proxy_reporter'
  | 'language_mismatch'
  | 'unresolved_contradiction'
  | 'corroborated_by_measurement'
  | 'consistent_across_turns'
  | 'detailed_articulate_answers';

export interface ConfidenceReason {
  readonly code: ConfidenceReasonCode;
  /** Signed contribution to the score, for an auditable breakdown. */
  readonly delta: number;
  readonly note: string;
}

export interface ConfidenceState {
  /** 0..1. */
  readonly score: number;
  readonly level: ConfidenceLevel;
  readonly reasons: readonly ConfidenceReason[];
  readonly contradictions: readonly Contradiction[];
  /**
   * THE Confidence Alert (§5.1). While true, the agent must ask harder-to-
   * deflect follow-ups and MUST NOT finalise a routing decision. This is a
   * hard gate in risk-policy.ts, not a suggestion to the model.
   */
  readonly alertActive: boolean;
  readonly alertRaisedAt?: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** Contradictions still awaiting a resolving follow-up. */
export function unresolvedContradictions(
  state: Pick<ConfidenceState, 'contradictions'>,
): readonly Contradiction[] {
  return state.contradictions.filter((c) => c.resolvedAt === undefined);
}
