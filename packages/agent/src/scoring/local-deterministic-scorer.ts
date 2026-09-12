/**
 * The clinical scoring engine. PRIMARY, not a fallback.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOW PRIMARY
 *
 * Infermedica was dropped from the project. It had been the only source of a
 * risk tier, with this class standing in when it was unreachable - which meant
 * every single assessment carried "clinical scoring engine unavailable" and
 * every red case escalated for that reason. Once Infermedica is gone for good,
 * that message is simply false, and a permanently-lit degradation banner
 * trains everyone to ignore the one signal that is supposed to mean something.
 *
 * So this engine is now the real one, and it says so. The property that made
 * the architecture worth defending is untouched: the tier comes from an
 * explicit, readable, deterministic rule table (`rules.ts`), never from a
 * language model. Groq still has no method that can return a tier.
 *
 * WHAT CHANGED IN BEHAVIOUR:
 *   - Returns `liveResult`, not `fallbackResult`. No degradation notice.
 *   - `source` is `local_rules`, a first-class engine, not `local_fallback`.
 *   - Red flags fire on WHAT was reported, not merely HOW MUCH. Chest pain
 *     spreading to the left arm is now an emergency because that combination
 *     is a recognised red flag, not because it is the third symptom counted.
 *
 * WHAT IT IS NOT: a validated clinical inference engine. It is a short,
 * explicit red-flag table. `rules.ts` sets out exactly what that means and why
 * the table is deliberately small. The 1 guardrail stands - this is decision
 * support in a simulated environment, and it routes to care rather than naming
 * a condition.
 * ---------------------------------------------------------------------------
 */

import type {
  ClockPort,
  RiskAssessment,
  RiskScoringPort,
  SeriousFlag,
  ToolResult,
  TriageLevel,
  TriageRequest,
  TriageTuple,
} from '@triage/shared';
import { liveResult, tierFor } from '@triage/shared';
import { PRESENT_COUNT_TO_LEVEL, applyRules } from './rules.js';

function isSymptomId(id: string): boolean {
  // Mirrors the ConceptId convention in @triage/shared (s_ / p_ / lt_).
  return id.startsWith('s_');
}

export function presentSymptomCount(evidence: TriageRequest['evidence']): number {
  return evidence.filter((e) => e.choice_id === 'present' && isSymptomId(e.id)).length;
}

export function levelForPresentCount(count: number): TriageLevel {
  return PRESENT_COUNT_TO_LEVEL[Math.min(count, PRESENT_COUNT_TO_LEVEL.length - 1)]!;
}

export class LocalDeterministicScorer implements RiskScoringPort {
  constructor(private readonly clock: Pick<ClockPort, 'now' | 'monotonicMs'>) {}

  async score(request: TriageRequest): Promise<ToolResult<RiskAssessment>> {
    const startedMs = this.clock.monotonicMs();

    const presentIds = request.evidence
      .filter((e) => e.choice_id === 'present')
      .map((e) => e.id);

    const outcome = applyRules(presentIds);

    // A fired rule is exactly what 5.3's "classic presentation" flag means:
    // the SCORING ENGINE recognised a pattern, as opposed to a model thinking
    // something looked textbook. Both arrays below feed that flag, and both
    // carry the rule's stated basis so the claim can be challenged.
    const seriousFlags: SeriousFlag[] = outcome.fired
      .filter((rule) => rule.requires.length === 1)
      .map((rule) => ({
        id: rule.requires[0]! as SeriousFlag['id'],
        name: rule.label,
        commonName: rule.label.toLowerCase(),
        seriousness: rule.level === 'emergency_ambulance' ? 'emergency' : 'serious',
        isEmergency: rule.level === 'emergency_ambulance',
      }));

    const triageTuples: TriageTuple[] = outcome.fired
      .filter((rule) => rule.requires.length > 1)
      .map((rule) => ({
        conceptIds: rule.requires as TriageTuple['conceptIds'],
        label: rule.label,
      }));

    const assessment: RiskAssessment = {
      tier: tierFor(outcome.level),
      triageLevel: outcome.level,
      ...(outcome.fired.length > 0
        ? { rootCause: `red_flag:${outcome.fired.map((r) => r.label).join(' + ')}` }
        : {}),
      seriousFlags,
      triageTuples,
      source: 'local_rules',
      evidenceCount: request.evidence.length,
      computedAt: this.clock.now(),
    };

    // A live result: this IS the engine. No degradation notice, because
    // nothing is degraded.
    return liveResult(assessment, this.clock.monotonicMs() - startedMs);
  }
}
