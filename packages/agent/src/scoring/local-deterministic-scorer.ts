/**
 * The local fallback clinical scorer — spec §6's required behavior when
 * Infermedica is unreachable or the trial's `/triage` quota is exhausted.
 *
 * THIS IS NOT A CLINICAL MODEL. It has no medical knowledge and does not
 * pretend to: it counts active, present symptom-concept evidence and maps the
 * count onto a triage level. Deliberately generic and NOT keyed to specific
 * concept ids — the demo fixture's placeholder ids are unverified (see the
 * root README), and hardcoding "s_98 is dangerous" into fallback logic would
 * silently encode a clinical claim nobody has checked. Counting is honest
 * about what it is: a crude, conservative placeholder, not a second opinion.
 *
 * "Conservative" here means what §6 requires: this scorer rounds risk UP with
 * thinner evidence than Infermedica would need, because acting on less
 * information is the safer failure mode when the real engine is unavailable.
 *
 * Always returns a `fallback` ToolResult — this port implementation IS the
 * fallback. The decision to call it (Infermedica first, this second) belongs
 * to the composed adapter built in packages/server; this package tests the
 * orchestration loop against it directly, which is exactly what the approved
 * plan calls for.
 */

import type {
  ClockPort,
  RiskAssessment,
  RiskScoringPort,
  ToolResult,
  TriageLevel,
  TriageRequest,
} from '@triage/shared';
import { fallbackResult, tierFor } from '@triage/shared';

const PRESENT_COUNT_TO_LEVEL: readonly TriageLevel[] = [
  'self_care', // 0 present symptoms
  'consultation', // 1
  'consultation_24', // 2
  'emergency', // 3
  'emergency_ambulance', // 4+
];

function isSymptomId(id: string): boolean {
  // Mirrors Infermedica's own convention (s_ / p_ / lt_ prefixes), which the
  // wire format already relies on — see ConceptId in @triage/shared.
  return id.startsWith('s_');
}

export function presentSymptomCount(evidence: TriageRequest['evidence']): number {
  return evidence.filter((e) => e.choice_id === 'present' && isSymptomId(e.id)).length;
}

export function levelForPresentCount(count: number): TriageLevel {
  const idx = Math.min(count, PRESENT_COUNT_TO_LEVEL.length - 1);
  return PRESENT_COUNT_TO_LEVEL[idx]!;
}

const DEGRADED_MESSAGE =
  'Clinical scoring service unavailable — falling back to a conservative local ' +
  'estimate based on symptom count. This is not a substitute for the validated ' +
  'clinical engine; treat the recommended action as a floor, not a ceiling.';

export class LocalDeterministicScorer implements RiskScoringPort {
  constructor(private readonly clock: Pick<ClockPort, 'now' | 'monotonicMs'>) {}

  async score(request: TriageRequest): Promise<ToolResult<RiskAssessment>> {
    const startedMs = this.clock.monotonicMs();
    const count = presentSymptomCount(request.evidence);
    const triageLevel = levelForPresentCount(count);

    const assessment: RiskAssessment = {
      tier: tierFor(triageLevel),
      triageLevel,
      seriousFlags: [],
      triageTuples: [],
      source: 'local_fallback',
      degradedReason: DEGRADED_MESSAGE,
      evidenceCount: request.evidence.length,
      computedAt: this.clock.now(),
    };

    return fallbackResult(assessment, this.clock.monotonicMs() - startedMs, {
      tool: 'infermedica.triage',
      reason: 'unavailable',
      userFacingMessage: DEGRADED_MESSAGE,
      fallbackUsed: 'LocalDeterministicScorer (symptom-count heuristic)',
      conservative: true,
    });
  }
}
