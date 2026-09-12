/**
 * Risk — axis one of the two the system tracks (spec §2).
 *
 * The tier is NEVER produced by Groq. It is computed by a deterministic
 * clinical engine (Infermedica `/triage`) or, when that engine is unavailable,
 * by a declared local fallback that says so out loud. The `source` and
 * `degraded` fields on every assessment are what make that distinction
 * visible instead of trusting a comment in a README.
 */

import type { Citation, IsoTimestamp } from './common.js';
import type { ConceptId } from './evidence.js';

/**
 * Infermedica `/triage` returns FIVE levels, not the three named in the spec.
 * Verified against developer.infermedica.com/docs/v3/triage. `serious` in the
 * spec's list is not a triage level at all — it is a separate array of flagged
 * evidence, modelled below as `SeriousFlag`.
 */
export const TRIAGE_LEVELS = [
  'emergency_ambulance',
  'emergency',
  'consultation_24',
  'consultation',
  'self_care',
] as const;
export type TriageLevel = (typeof TRIAGE_LEVELS)[number];

/**
 * The four-tier presentation used everywhere in the UI (5.1).
 *
 * ORANGE EXISTS TO SPLIT A TIER THAT WAS DOING TWO JOBS. With three tiers,
 * `consultation` ("see someone, not urgently") and `consultation_24` ("be seen
 * within a day") both landed on yellow, so the screen could not distinguish
 * "book an appointment" from "go now, but you do not need an ambulance". Those
 * are different actions for the patient and they deserve different colours.
 *
 * Orange is therefore NOT a softer red. It is the top of the
 * self-transport band: urgent, ambulance not indicated.
 */
export const RISK_TIERS = ['green', 'yellow', 'orange', 'red'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/** Ordering, so "did risk get worse?" is a comparison and not a pile of ifs. */
export const RISK_TIER_RANK: Record<RiskTier, number> = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

/**
 * A piece of evidence Infermedica itself flagged as serious. Feeds the
 * "classic presentation" flag on the doctor handoff card (§5.3) — it does NOT
 * set the tier.
 */
export interface SeriousFlag {
  readonly id: ConceptId;
  readonly name: string;
  readonly commonName?: string;
  readonly seriousness: 'serious' | 'emergency';
  readonly isEmergency: boolean;
}

/**
 * Spec §6: triage tuples are pairs of individually-mild findings that are
 * jointly dangerous (Infermedica's documented example: hypertension +
 * third-trimester pregnancy). This is the concrete mechanism behind
 * Confidence-Based Escalation — the "combine and re-evaluate" moment comes
 * from the scoring engine, not from prompt text.
 */
export interface TriageTuple {
  readonly conceptIds: readonly ConceptId[];
  readonly label: string;
  readonly citation?: Citation;
}

/** Which engine produced an assessment. Surfaced in the UI, never hidden. */
export type RiskSource =
  /** Live Infermedica `/triage` response. Full confidence. */
  | 'infermedica'
  /**
   * Local deterministic rule table. Used when Infermedica is unreachable or
   * out of quota. Conservative by construction — it rounds UP, never down.
   * Always accompanied by a DegradationNotice (spec §6 fallback requirement).
   */
  | 'local_fallback';

export interface RiskAssessment {
  readonly tier: RiskTier;
  readonly triageLevel: TriageLevel;
  /** Infermedica's explanation, e.g. `serious_evidence_present`. */
  readonly rootCause?: string;
  readonly seriousFlags: readonly SeriousFlag[];
  readonly triageTuples: readonly TriageTuple[];
  /** Whether Infermedica considers remote consultation viable for this case. */
  readonly teleconsultationApplicable?: boolean;

  readonly source: RiskSource;
  /**
   * Present iff `source === 'local_fallback'`. Carries the sentence shown to
   * the user. Its presence is the single switch for the UI degradation banner.
   */
  readonly degradedReason?: string;

  /** How many active evidence items this was computed from — shown in the ledger. */
  readonly evidenceCount: number;
  readonly computedAt: IsoTimestamp;
}

/**
 * Severity out of 10 for the doctor handoff card (§5.3). Derived from the
 * triage level so it traces back to the clinical engine and is never a number
 * Groq invented. Kept as a function rather than a free field precisely so that
 * no code path can assign an arbitrary value.
 */
export const SEVERITY_BY_TRIAGE_LEVEL: Record<TriageLevel, number> = {
  emergency_ambulance: 10,
  emergency: 8,
  consultation_24: 5,
  consultation: 3,
  self_care: 1,
};

export function severityScore(assessment: Pick<RiskAssessment, 'triageLevel'>): number {
  return SEVERITY_BY_TRIAGE_LEVEL[assessment.triageLevel];
}

/** Did risk get worse between two assessments? Drives the §5.4 escalation trace. */
export function isEscalation(previous: RiskTier, next: RiskTier): boolean {
  return RISK_TIER_RANK[next] > RISK_TIER_RANK[previous];
}

/** Trend direction for Companion Mode monitoring (§5.4). */
export type TrendDirection = 'worsening' | 'stable' | 'improving';

export function trendBetween(previous: RiskTier, next: RiskTier): TrendDirection {
  const delta = RISK_TIER_RANK[next] - RISK_TIER_RANK[previous];
  if (delta > 0) return 'worsening';
  if (delta < 0) return 'improving';
  return 'stable';
}
