/**
 * Communication state — axis three of the per-turn read-out (spec §8).
 *
 * THE LOAD-BEARING RULE OF THIS FILE, from §8:
 *
 *   "tone adapts, but clinical rigor and safety gates never soften based on
 *    tone — a panicked user receives the same underlying logic and confirmation
 *    requirements as a calm one, delivered more gently, never less rigorously."
 *
 * So `CommunicationState` is deliberately NOT accepted as a parameter by
 * anything in `policy/risk-policy.ts`. Tone can change wording, sentence
 * length, and which phrasing of a question gets asked. It can never change
 * which questions are mandatory, which gate an action requires, or what tier
 * the evidence produces. That separation is enforced by function signatures
 * rather than left to the model's discretion.
 */

import type { IsoTimestamp } from './common.js';

export const COMMUNICATION_STATES = [
  /** Fragments, caps, exclamation marks, "please help", rapid unrelated details. */
  'panicked',
  /** Vague answers, self-contradiction, "I don't know what that means". */
  'confused',
  /** "fine", "yes", "no" — likely under-reporting. Feeds confidence, not just tone. */
  'terse',
  /** Correct terminology, precise timelines. Move faster, skip basics. */
  'articulate',
  /** Child or clearly distressed minor. Simpler, warmer, loop in an adult sooner. */
  'minor',
  /** Family Relay Mode active — more clinical precision, less emotional softening. */
  'caregiver_relay',
  /** Nothing distinctive detected yet. The starting state. */
  'neutral',
] as const;
export type CommunicationState = (typeof COMMUNICATION_STATES)[number];

/** Observable signals that justified the read. Keeps the classification auditable. */
export type CommunicationSignal =
  | 'all_caps'
  | 'repeated_punctuation'
  | 'sentence_fragments'
  | 'explicit_plea_for_help'
  | 'very_short_answers'
  | 'self_contradiction'
  | 'expressed_incomprehension'
  | 'medical_terminology_used'
  | 'precise_timeline_given'
  | 'stated_age_minor'
  | 'third_person_reporting'
  | 'non_responsive'
  | 'language_switch';

export interface CommunicationRead {
  readonly state: CommunicationState;
  /** 0..1 — how sure the classifier is. Low confidence falls back to `neutral`. */
  readonly certainty: number;
  readonly signals: readonly CommunicationSignal[];
  readonly detectedLanguage?: string;
  readonly since: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Delivery directives derived from the communication state. This is the ONLY
 * thing tone is allowed to influence. Every field here is about presentation:
 * none of them can remove a required question or weaken a gate.
 */
export interface ToneDirective {
  /** Upper bound on sentence length. Shorter as urgency rises, never longer (§8). */
  readonly maxSentenceWords: number;
  /** Hard cap of one question per turn when risk is elevated (§8). */
  readonly maxQuestionsPerTurn: 1;
  /** Open with a one-line acknowledgement so it does not feel like an interrogation. */
  readonly acknowledgeFirst: boolean;
  /** Prefer `commonName` over the professional `name` for every concept. */
  readonly usePlainLanguage: boolean;
  /** Repeat understanding back before moving on (confused / minor). */
  readonly confirmUnderstanding: boolean;
  /** Add an explicit grounding line ("I'm here, one step at a time"). */
  readonly groundingLine: boolean;
  /** Terse speakers get sharper, harder-to-deflect phrasing instead of yes/no bait. */
  readonly useHardToDeflectPhrasing: boolean;
  /** Prefer routing a caregiver/adult into the loop (minor, non-responsive patient). */
  readonly preferAdultInvolvement: boolean;
}

/**
 * Fixed table, not a model decision — the mapping from state to delivery is
 * part of the spec and should be reviewable at a glance.
 */
export const TONE_DIRECTIVES: Record<CommunicationState, ToneDirective> = {
  panicked: {
    maxSentenceWords: 8,
    maxQuestionsPerTurn: 1,
    acknowledgeFirst: true,
    usePlainLanguage: true,
    confirmUnderstanding: false,
    groundingLine: true,
    useHardToDeflectPhrasing: false,
    preferAdultInvolvement: false,
  },
  confused: {
    maxSentenceWords: 10,
    maxQuestionsPerTurn: 1,
    acknowledgeFirst: true,
    usePlainLanguage: true,
    confirmUnderstanding: true,
    groundingLine: false,
    useHardToDeflectPhrasing: false,
    preferAdultInvolvement: true,
  },
  terse: {
    maxSentenceWords: 14,
    maxQuestionsPerTurn: 1,
    acknowledgeFirst: true,
    usePlainLanguage: true,
    confirmUnderstanding: false,
    groundingLine: false,
    useHardToDeflectPhrasing: true,
    preferAdultInvolvement: false,
  },
  articulate: {
    maxSentenceWords: 22,
    maxQuestionsPerTurn: 1,
    acknowledgeFirst: true,
    usePlainLanguage: false,
    confirmUnderstanding: false,
    groundingLine: false,
    useHardToDeflectPhrasing: false,
    preferAdultInvolvement: false,
  },
  minor: {
    maxSentenceWords: 8,
    maxQuestionsPerTurn: 1,
    acknowledgeFirst: true,
    usePlainLanguage: true,
    confirmUnderstanding: true,
    groundingLine: true,
    useHardToDeflectPhrasing: false,
    preferAdultInvolvement: true,
  },
  caregiver_relay: {
    maxSentenceWords: 20,
    maxQuestionsPerTurn: 1,
    acknowledgeFirst: false,
    usePlainLanguage: false,
    confirmUnderstanding: false,
    groundingLine: false,
    useHardToDeflectPhrasing: true,
    preferAdultInvolvement: false,
  },
  neutral: {
    maxSentenceWords: 16,
    maxQuestionsPerTurn: 1,
    acknowledgeFirst: true,
    usePlainLanguage: true,
    confirmUnderstanding: false,
    groundingLine: false,
    useHardToDeflectPhrasing: false,
    preferAdultInvolvement: false,
  },
};

/**
 * §8: sentences get SHORTER as urgency rises, not longer. Applied on top of the
 * state's own limit, so a panicked-and-red user gets the tightest phrasing.
 */
export function sentenceBudget(directive: ToneDirective, urgent: boolean): number {
  return urgent ? Math.min(directive.maxSentenceWords, 10) : directive.maxSentenceWords;
}
