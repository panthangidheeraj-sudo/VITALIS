/**
 * The clinical rule table behind the primary scorer.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, STATED HONESTLY
 *
 * This is a small, explicit, deterministic red-flag table. It is NOT a
 * validated clinical inference engine, and the project must never describe it
 * as one. What it IS:
 *
 *   - Deterministic. The same evidence always produces the same tier, which is
 *     what makes the demo reproducible and the behaviour auditable.
 *   - Non-LLM. No model can reach a risk tier through this path, which is the
 *     single most important property of the whole architecture (6).
 *   - Readable. Every rule is one line with its reasoning attached, so a
 *     clinician reviewing this can see exactly what the system believes and
 *     say "that one is wrong" - which is impossible with a model's weights.
 *   - Conservative. Rules only ever raise the tier, never lower it.
 *
 * The rules below encode well-established emergency red flags of the kind
 * taught in basic first aid and used in standard triage protocols. They are
 * intentionally few. A short table of things that are uncontroversially
 * emergencies is defensible; a long table pretending to cover medicine is not.
 * ---------------------------------------------------------------------------
 *
 * CONCEPT IDS MUST MATCH THE NORMALIZATION LAYER. These ids are the ones the
 * lexicon emits. `rules.test.ts` asserts every id used here is one the system
 * can actually produce, so a renamed concept fails the build instead of
 * silently disabling a red flag - a rule that never fires is worse than no
 * rule, because everyone assumes it is working.
 */

import type { TriageLevel } from '@triage/shared';

export interface RedFlagRule {
  /** All of these must be present for the rule to fire. */
  readonly requires: readonly string[];
  /** Level this rule forces. Applied as a floor, never a ceiling. */
  readonly level: TriageLevel;
  /** Shown on the handoff card and in the timeline. */
  readonly label: string;
  /** Why this is a red flag. Printed so the claim can be challenged. */
  readonly basis: string;
}

/**
 * Single findings that are emergencies on their own.
 *
 * Each of these is an emergency because of what it may indicate, not because
 * it is certainly that thing - which is exactly why the system routes to care
 * rather than naming a condition.
 */
export const SINGLE_RED_FLAGS: readonly RedFlagRule[] = [
  {
    requires: ['s_205'],
    level: 'emergency_ambulance',
    label: 'Loss of consciousness',
    basis:
      'Anyone who has lost consciousness needs assessment now, whatever the cause. This is the one finding where self-transport is not appropriate.',
  },
  {
    requires: ['s_13'],
    level: 'emergency',
    label: 'Difficulty breathing',
    basis: 'Breathing difficulty is time-critical regardless of what is causing it.',
  },
  {
    requires: ['s_1148'],
    level: 'emergency',
    label: 'Bleeding',
    basis:
      'Bleeding is escalated on report because severity cannot be established through an interview, and under-reacting is the worse error.',
  },
];

/**
 * Combinations that are dangerous together while each part alone is not.
 *
 * This is the "combine and re-evaluate" mechanism the spec cares about (6's
 * triage tuples): the agent learns one more symptom, and a case that was
 * unremarkable becomes urgent. It is also what makes the six-beat demo trace
 * happen for a real reason rather than because a counter crossed a threshold.
 */
export const COMBINATION_RED_FLAGS: readonly RedFlagRule[] = [
  {
    requires: ['s_21', 's_98'],
    level: 'emergency_ambulance',
    label: 'Chest pain radiating to the left arm',
    basis:
      'Chest pain that spreads to the arm is the classic presentation taught for a possible heart attack. Either finding alone is much less specific.',
  },
  {
    requires: ['s_21', 's_13'],
    level: 'emergency_ambulance',
    label: 'Chest pain with difficulty breathing',
    basis: 'Chest pain together with breathlessness is a recognised emergency combination.',
  },
  {
    requires: ['s_21', 's_47'],
    level: 'emergency',
    label: 'Chest pain with sweating',
    basis: 'Sweating alongside chest pain raises concern beyond either finding alone.',
  },
  {
    requires: ['s_21', 's_112'],
    level: 'emergency',
    label: 'Chest pain radiating to the jaw',
    basis: 'Pain spreading to the jaw is a documented atypical presentation of cardiac pain.',
  },
  {
    requires: ['s_1193', 's_16'],
    level: 'emergency',
    label: 'Headache with vomiting',
    basis:
      'A headache with vomiting can indicate raised intracranial pressure and warrants urgent assessment.',
  },
];

/**
 * Count-based floor for everything the table above does not name.
 *
 * Kept from the previous scorer for a specific reason: without it, a patient
 * reporting five symptoms that happen not to appear in the rules would score
 * `self_care`. A rule table with a silent hole in it is more dangerous than no
 * rule table. Accumulating symptoms raises the floor regardless.
 */
export const PRESENT_COUNT_TO_LEVEL: readonly TriageLevel[] = [
  'self_care', // 0 present symptoms
  'consultation', // 1
  'consultation_24', // 2
  'emergency', // 3
  'emergency_ambulance', // 4+
];

/** Severity order, so "take the worse of the two" is a comparison. */
const LEVEL_RANK: Record<TriageLevel, number> = {
  self_care: 0,
  consultation: 1,
  consultation_24: 2,
  emergency: 3,
  emergency_ambulance: 4,
};

export function worseOf(a: TriageLevel, b: TriageLevel): TriageLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export interface RuleOutcome {
  readonly level: TriageLevel;
  /** Rules that fired, for the handoff card's "classic presentation" flag. */
  readonly fired: readonly RedFlagRule[];
}

/**
 * Applies every rule and takes the WORST level any of them produced, never an
 * average and never the first match. Rules are a floor: an additional symptom
 * can only ever raise the result.
 */
export function applyRules(presentConceptIds: readonly string[]): RuleOutcome {
  const present = new Set(presentConceptIds);
  const fired: RedFlagRule[] = [];
  let level: TriageLevel = 'self_care';

  for (const rule of [...SINGLE_RED_FLAGS, ...COMBINATION_RED_FLAGS]) {
    if (rule.requires.every((id) => present.has(id))) {
      fired.push(rule);
      level = worseOf(level, rule.level);
    }
  }

  // The count floor applies whether or not any rule fired.
  const symptomCount = presentConceptIds.filter((id) => id.startsWith('s_')).length;
  const byCount = PRESENT_COUNT_TO_LEVEL[Math.min(symptomCount, PRESENT_COUNT_TO_LEVEL.length - 1)]!;

  return { level: worseOf(level, byCount), fired };
}
