/**
 * Schemas for everything Groq returns — the verification gate.
 *
 * Spec §2 contrasts the system with a plain chatbot on the line "No verification
 * gate before responding". This file is that gate. Every model response is
 * parsed here before it is allowed to touch case state; a response that does
 * not validate is a `ToolError` of kind `invalid_response`, not a value to be
 * coerced or partially salvaged.
 *
 * Each schema is also exported as JSON Schema for Groq's structured-outputs
 * parameter, so the same definition constrains generation AND checks the
 * result. One definition, both ends — they cannot drift.
 *
 * THE HARD RULE (§6): no schema in this file contains a risk tier, a triage
 * level, or a severity score. The model is structurally unable to return one.
 * Clinical classification comes from `RiskScoringPort` and nowhere else.
 */

import { z } from 'zod';
import { COMMUNICATION_STATES } from '../types/communication.js';
import { conceptIdSchema, languageSchema, unitIntervalSchema } from './primitives.js';

// --- Question selection ------------------------------------------------------

export const selectedQuestionSchema = z.object({
  /** The question as it will be shown, already tone- and language-adjusted. */
  text: z.string().min(1).max(300),
  /** Which concepts this question is trying to resolve. */
  targetConceptIds: z.array(conceptIdSchema).min(1).max(3),
  /** Why this question and not another. Shown in the reasoning panel. */
  rationale: z.string().min(1).max(400),
  /**
   * The problem statement requires minimising unnecessary questioning. Forcing
   * the model to state what it expects to learn makes that auditable rather
   * than aspirational — and lets tests assert the agent is not asking
   * low-value questions on a Red case.
   */
  expectedInformationGain: unitIntervalSchema,
  choices: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
    .max(6)
    .optional(),
  language: languageSchema,
  /** True when phrased to be hard to brush off (terse speaker / active alert). */
  hardToDeflect: z.boolean(),
});

// --- Contradiction detection -------------------------------------------------

/**
 * Note what is absent: the model reports that two things CONFLICT and cites the
 * evidence ids. It does not decide what the conflict means for risk, and it
 * cannot set `alertActive` — that is the policy layer's call.
 */
export const detectedContradictionSchema = z.object({
  kind: z.enum([
    'self_report_vs_evidence',
    'cross_turn_reversal',
    'vital_vs_statement',
    'timeline_inconsistency',
    'caregiver_vs_patient',
  ]),
  detail: z.string().min(1).max(400),
  conflictingEvidenceIds: z.array(z.string().min(1)).min(2),
  /** How sure the model is. Low-certainty findings are probed, not acted on. */
  certainty: unitIntervalSchema,
});

export const contradictionListSchema = z.object({
  contradictions: z.array(detectedContradictionSchema).max(5),
});

// --- Communication state read ------------------------------------------------

export const communicationReadOutputSchema = z.object({
  state: z.enum(COMMUNICATION_STATES),
  certainty: unitIntervalSchema,
  signals: z
    .array(
      z.enum([
        'all_caps',
        'repeated_punctuation',
        'sentence_fragments',
        'explicit_plea_for_help',
        'very_short_answers',
        'self_contradiction',
        'expressed_incomprehension',
        'medical_terminology_used',
        'precise_timeline_given',
        'stated_age_minor',
        'third_person_reporting',
        'non_responsive',
        'language_switch',
      ]),
    )
    .max(8),
  detectedLanguage: languageSchema.optional(),
});

// --- Injury photo description (§5.7) -----------------------------------------

/**
 * A vision tool call, deliberately not a trained classifier. It describes what
 * is VISIBLE. It does not name a condition — `suggestedConceptTerms` are plain
 * search terms handed to Infermedica `/search` for normalisation, so even the
 * concept mapping is done by the clinical layer rather than the model.
 */
export const photoObservationSchema = z.object({
  visibleSigns: z
    .array(
      z.enum([
        'bleeding',
        'heavy_bleeding',
        'swelling',
        'bruising',
        'burn',
        'blistering',
        'discolouration',
        'deformity',
        'open_wound',
        'rash',
        'foreign_object',
        'pallor',
        'none_visible',
      ]),
    )
    .max(8),
  description: z.string().min(1).max(600),
  suggestedConceptTerms: z.array(z.string().min(1)).max(6),
  /** A blurry or dark photo must not be treated as a measurement. */
  imageQuality: unitIntervalSchema,
});

// --- Composed patient-facing message ----------------------------------------

export const composedResponseSchema = z.object({
  /** §8: every response in an active emergency ends with a concrete next step. */
  message: z.string().min(1).max(800),
  /** The question or instruction that closes the message. Required, not optional. */
  nextStep: z.string().min(1).max(200),
  language: languageSchema,
});

// --- Translation -------------------------------------------------------------

export const translationSchema = z.object({
  text: z.string().min(1),
  language: languageSchema,
  /** §8 requires tone parity, not just literal meaning. */
  tonePreserved: z.literal(true),
});

// --- JSON Schema export for Groq structured outputs --------------------------

/**
 * Groq's `response_format: { type: 'json_schema' }` wants a JSON Schema. Rather
 * than pull in a converter dependency for six schemas, the shapes are declared
 * once here in the form the API expects and kept beside their zod twins.
 * `groq-schema-parity.test.ts` asserts the two agree on required keys, so a
 * field added to one and forgotten in the other fails the build.
 */
export const GROQ_JSON_SCHEMAS = {
  select_next_question: {
    type: 'object',
    additionalProperties: false,
    // NOTE: `required` lists EVERY property, including the ones zod treats as
    // optional. That is not a mistake and not a change of contract - Groq's
    // strict structured-output mode rejects a schema whose `required` omits any
    // declared property ("`required` ... must include every key in
    // properties"). Genuinely optional fields are expressed as nullable
    // instead, and the adapter drops nulls before zod sees them, so the zod
    // schema stays the single source of truth about what is optional.
    required: [
      'text',
      'targetConceptIds',
      'rationale',
      'expectedInformationGain',
      'choices',
      'language',
      'hardToDeflect',
    ],
    properties: {
      text: { type: 'string' },
      targetConceptIds: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
      expectedInformationGain: { type: 'number', minimum: 0, maximum: 1 },
      choices: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label'],
          properties: { id: { type: 'string' }, label: { type: 'string' } },
        },
      },
      language: { type: 'string', enum: ['en', 'hi', 'te', 'ta'] },
      hardToDeflect: { type: 'boolean' },
    },
  },
  detect_contradiction: {
    type: 'object',
    additionalProperties: false,
    required: ['contradictions'],
    properties: {
      contradictions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'detail', 'conflictingEvidenceIds', 'certainty'],
          properties: {
            kind: {
              type: 'string',
              enum: [
                'self_report_vs_evidence',
                'cross_turn_reversal',
                'vital_vs_statement',
                'timeline_inconsistency',
                'caregiver_vs_patient',
              ],
            },
            detail: { type: 'string' },
            conflictingEvidenceIds: { type: 'array', items: { type: 'string' } },
            certainty: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
  read_communication_state: {
    type: 'object',
    additionalProperties: false,
    required: ['state', 'certainty', 'signals', 'detectedLanguage'],
    properties: {
      state: { type: 'string', enum: [...COMMUNICATION_STATES] },
      certainty: { type: 'number', minimum: 0, maximum: 1 },
      signals: { type: 'array', items: { type: 'string' } },
      // Nullable rather than absent - see the note on select_next_question.
      detectedLanguage: { type: ['string', 'null'], enum: ['en', 'hi', 'te', 'ta', null] },
    },
  },
  describe_injury_photo: {
    type: 'object',
    additionalProperties: false,
    required: ['visibleSigns', 'description', 'suggestedConceptTerms', 'imageQuality'],
    properties: {
      visibleSigns: { type: 'array', items: { type: 'string' } },
      description: { type: 'string' },
      suggestedConceptTerms: { type: 'array', items: { type: 'string' } },
      imageQuality: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  compose_response: {
    type: 'object',
    additionalProperties: false,
    required: ['message', 'nextStep', 'language'],
    properties: {
      message: { type: 'string' },
      nextStep: { type: 'string' },
      language: { type: 'string', enum: ['en', 'hi', 'te', 'ta'] },
    },
  },
  translate: {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'language', 'tonePreserved'],
    properties: {
      text: { type: 'string' },
      language: { type: 'string', enum: ['en', 'hi', 'te', 'ta'] },
      tonePreserved: { type: 'boolean', const: true },
    },
  },
} as const;

/** Pairs each JSON Schema with the zod schema that must accept the same shape. */
export const GROQ_SCHEMA_PAIRS = [
  { name: 'select_next_question', zod: selectedQuestionSchema },
  { name: 'detect_contradiction', zod: contradictionListSchema },
  { name: 'read_communication_state', zod: communicationReadOutputSchema },
  { name: 'describe_injury_photo', zod: photoObservationSchema },
  { name: 'compose_response', zod: composedResponseSchema },
  { name: 'translate', zod: translationSchema },
] as const;

/**
 * Terms that must never appear as a key in any Groq output schema. Asserted in
 * tests — the cheapest possible guard against someone later adding a
 * `riskTier` field "just for convenience" and quietly letting the model score.
 */
export const FORBIDDEN_MODEL_OUTPUT_KEYS = [
  'riskTier',
  'tier',
  'triageLevel',
  'severity',
  'severityOutOfTen',
  'diagnosis',
  'condition',
  'prescription',
] as const;
