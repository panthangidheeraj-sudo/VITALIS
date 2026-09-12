/**
 * Deterministic confidence scoring — pure, no I/O, no model call.
 *
 * Spec §2's second axis needs the same property risk scoring has: a reader
 * should be able to see WHY the number is what it is. Groq's job is limited to
 * *detecting* a contradiction (`ReasoningPort.detectContradiction`) and
 * *reading* communication state — both facts about the input. Turning those
 * facts into a 0..1 score with an auditable breakdown is arithmetic, not
 * judgement, so it lives here rather than in a prompt.
 *
 * This mirrors `policy/risk-policy.ts` in @triage/shared deliberately. It is
 * NOT in @triage/shared itself because it consumes `CommunicationRead`, which
 * `risk-policy.ts` is explicitly forbidden from doing (§8's tone/rigor
 * separation) — keeping it in the agent package makes that boundary a
 * dependency fact, not just a comment.
 */

import type {
  CommunicationRead,
  ConfidenceReason,
  ConfidenceReasonCode,
  ConfidenceState,
  Contradiction,
  EvidenceItem,
  IsoTimestamp,
} from '@triage/shared';
import { activeEvidence, confidenceLevelFor, unresolvedContradictions } from '@triage/shared';

const BASELINE_SCORE = 0.6;
const RICH_EVIDENCE_THRESHOLD = 4;

export interface ConfidenceInput {
  readonly evidence: readonly EvidenceItem[];
  readonly contradictions: readonly Contradiction[];
  readonly communication: CommunicationRead;
  readonly minEvidenceToScore: number;
  readonly previous?: ConfidenceState;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeConfidence(input: ConfidenceInput, now: IsoTimestamp): ConfidenceState {
  const reasons: ConfidenceReason[] = [];
  const push = (code: ConfidenceReasonCode, delta: number, note: string) =>
    reasons.push({ code, delta, note });

  const activeCount = activeEvidence(input.evidence).length;

  if (activeCount < input.minEvidenceToScore) {
    push(
      'sparse_evidence',
      -0.2,
      `Only ${activeCount} active evidence item(s); ${input.minEvidenceToScore} needed to score.`,
    );
  } else if (activeCount >= RICH_EVIDENCE_THRESHOLD) {
    push('consistent_across_turns', 0.15, `${activeCount} active evidence items on record.`);
  }

  const unresolved = unresolvedContradictions({ contradictions: input.contradictions });
  if (unresolved.length > 0) {
    push(
      'unresolved_contradiction',
      -0.3 * Math.min(unresolved.length, 2),
      `${unresolved.length} unresolved contradiction(s): ${unresolved.map((c) => c.kind).join(', ')}.`,
    );
  }

  for (const c of input.contradictions) {
    if (c.resolvedAt === undefined) continue;
    const resolvedByMeasurement = c.resolutionNote?.includes('measured') ?? false;
    push(
      resolvedByMeasurement ? 'corroborated_by_measurement' : 'proxy_reporter',
      resolvedByMeasurement ? 0.2 : 0.1,
      `Contradiction (${c.kind}) resolved: ${c.resolutionNote ?? 'no detail recorded'}`,
    );
  }

  switch (input.communication.state) {
    case 'terse':
      push('terse_answers', -0.1, 'Terse answers raise the risk of under-reporting.');
      break;
    case 'confused':
      push('vague_or_uncertain_answers', -0.1, 'Answers indicate confusion or low health literacy.');
      break;
    case 'articulate':
      push('detailed_articulate_answers', 0.1, 'Precise, detailed answers given.');
      break;
    default:
      break;
  }

  const delta = reasons.reduce((sum, r) => sum + r.delta, 0);
  const score = clamp01(BASELINE_SCORE + delta);
  const level = confidenceLevelFor(score);

  // The alert tracks unresolved contradictions directly — a second, separate
  // threshold here would let a low SCORE and an active ALERT disagree with
  // each other, which is exactly the kind of internal inconsistency this
  // whole axis exists to prevent.
  const alertActive = unresolved.length > 0;
  const alertRaisedAt = alertActive
    ? input.previous?.alertActive === true
      ? input.previous.alertRaisedAt
      : now
    : input.previous?.alertRaisedAt;

  return {
    score,
    level,
    reasons,
    contradictions: input.contradictions,
    alertActive,
    ...(alertRaisedAt !== undefined ? { alertRaisedAt } : {}),
    updatedAt: now,
  };
}
