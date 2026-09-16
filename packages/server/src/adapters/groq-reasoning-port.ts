/**
 * Groq - ReasoningPort.
 *
 * Selects questions, spots contradictions, reads tone, translates, describes
 * photos and composes messages. It does NOT score. `ReasoningPort` has no
 * method that returns a tier, no schema in `groq-outputs.ts` has a field one
 * could hide in, and every prompt in `groq-prompts.ts` forbids it in prose as
 * well. Three independent layers, because this is the one boundary whose
 * failure would invalidate the whole design.
 *
 * TWO THINGS WORTH KNOWING BEFORE EDITING:
 *
 * 1. EVERY call is validated by the matching zod schema before the value is
 *    returned. That is the section 2 "verification gate": a response that does
 *    not parse is an `invalid_response` error, never something to coerce or
 *    partially salvage. The same shape is also sent to Groq as a JSON Schema,
 *    so generation is constrained by the definition that checks it.
 *
 * 2. Failure DELEGATES to a fallback ReasoningPort rather than throwing. The
 *    interview must continue when Groq is down - the deterministic stand-in
 *    asks a duller question, and the patient is told the assistant is running
 *    in a reduced mode. An emergency interview that stops because a language
 *    model is rate-limited is the worst possible outcome, and it is the one
 *    that actually happens on a free tier.
 */

import type {
  CommunicationRead,
  Contradiction,
  ContradictionCheckRequest,
  Language,
  PhotoObservation,
  QuestionSelectionRequest,
  ReasoningPort,
  SelectedQuestion,
  ToolResult,
} from '@triage/shared';
import {
  GROQ_JSON_SCHEMAS,
  asEvidenceId,
  communicationReadOutputSchema,
  composedResponseSchema,
  contradictionListSchema,
  fallbackResult,
  liveResult,
  photoObservationSchema,
  selectedQuestionSchema,
  translationSchema,
} from '@triage/shared';
import type { z } from 'zod';
import { requestJsonWithKeys } from './http.js';
import {
  COMPOSE_RESPONSE_PROMPT,
  DESCRIBE_INJURY_PHOTO_PROMPT,
  DETECT_CONTRADICTION_PROMPT,
  READ_COMMUNICATION_STATE_PROMPT,
  SELECT_NEXT_QUESTION_PROMPT,
  TRANSLATE_PROMPT,
} from './groq-prompts.js';

export interface GroqConfig {
  /** Primary key first, then spares — see http.ts's `requestJsonWithKeys`. */
  readonly apiKeys: readonly string[];
  readonly baseUrl: string;
  readonly textModel: string;
  readonly visionModel: string;
}

interface ChatCompletion {
  readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
}

type SchemaName = keyof typeof GROQ_JSON_SCHEMAS;

/** What a degraded call looks like to the patient. One sentence, no hedging. */
const REDUCED_MODE_MESSAGE =
  'My question-selection service is unavailable, so I am asking from a simpler script. Everything I have recorded is intact, and the risk assessment is unaffected.';

export class GroqReasoningPort implements ReasoningPort {
  constructor(
    private readonly config: GroqConfig,
    /**
     * Used whenever a Groq call fails or fails validation. Injected rather than
     * constructed here so the degraded path is the SAME code that is exercised
     * by 120 existing tests, not a second, less-tested implementation.
     */
    private readonly fallback: ReasoningPort,
  ) {}

  // --- Question selection ---------------------------------------------------

  async selectNextQuestion(
    request: QuestionSelectionRequest,
  ): Promise<ToolResult<SelectedQuestion>> {
    const parsed = await this.call(
      'select_next_question',
      selectedQuestionSchema,
      SELECT_NEXT_QUESTION_PROMPT,
      JSON.stringify({
        language: request.language,
        mustBeHardToDeflect: request.requireHardToDeflect,
        candidateConceptIds: request.candidateConceptIds,
        askedSoFar: request.state.evidence.map((e) => e.conceptId),
        patientWords: recentPatientWords(request),
        ageYears: request.state.demographics.ageYears,
        sex: request.state.demographics.sex,
      }),
    );

    if (parsed.value === undefined) {
      return this.degrade(
        await this.fallback.selectNextQuestion(request),
        'groq.select_next_question',
        parsed.latencyMs,
      );
    }

    const q = parsed.value;
    return liveResult(
      {
        text: q.text,
        targetConceptIds: q.targetConceptIds,
        rationale: q.rationale,
        expectedInformationGain: q.expectedInformationGain,
        ...(q.choices === undefined ? {} : { choices: q.choices }),
        language: q.language,
        // The POLICY decides whether a question must be hard to deflect, not
        // the model. If the request demanded it, that stands regardless of what
        // came back - otherwise a model that ignored the instruction would also
        // get to overwrite the flag saying it had.
        hardToDeflect: request.requireHardToDeflect || q.hardToDeflect,
      },
      parsed.latencyMs,
    );
  }

  // --- Contradiction detection ----------------------------------------------

  async detectContradiction(
    request: ContradictionCheckRequest,
  ): Promise<ToolResult<readonly Contradiction[]>> {
    const now = new Date().toISOString();
    const knownIds = new Set(request.state.evidence.map((e) => String(e.id)));

    const parsed = await this.call(
      'detect_contradiction',
      contradictionListSchema,
      DETECT_CONTRADICTION_PROMPT,
      JSON.stringify({
        newInput: request.newInputText,
        evidenceOnRecord: request.state.evidence.map((e) => ({
          id: e.id,
          concept: e.conceptId,
          answer: e.choiceId,
          source: e.source,
          observedAt: e.observedAt,
        })),
      }),
    );

    if (parsed.value === undefined) {
      return this.degrade(
        await this.fallback.detectContradiction(request),
        'groq.detect_contradiction',
        parsed.latencyMs,
      );
    }

    // A hallucinated evidence id would create a contradiction pointing at
    // nothing, which the confidence policy would then be unable to resolve -
    // permanently blocking routing. Conflicts citing unknown ids are dropped.
    const contradictions: Contradiction[] = parsed.value.contradictions
      .filter((c) => c.conflictingEvidenceIds.every((id) => knownIds.has(id)))
      .map((c) => ({
        kind: c.kind,
        detail: c.detail,
        conflictingEvidenceIds: c.conflictingEvidenceIds.map(asEvidenceId),
        detectedAt: now,
      }));

    return liveResult(contradictions, parsed.latencyMs);
  }

  // --- Communication state --------------------------------------------------

  async readCommunicationState(
    recentInputs: readonly string[],
    current: CommunicationRead,
  ): Promise<ToolResult<CommunicationRead>> {
    const parsed = await this.call(
      'read_communication_state',
      communicationReadOutputSchema,
      READ_COMMUNICATION_STATE_PROMPT,
      JSON.stringify({ recentInputs, currentState: current.state }),
    );

    if (parsed.value === undefined) {
      return this.degrade(
        await this.fallback.readCommunicationState(recentInputs, current),
        'groq.read_communication_state',
        parsed.latencyMs,
      );
    }

    const now = new Date().toISOString();
    const changed = parsed.value.state !== current.state;
    return liveResult(
      {
        state: parsed.value.state,
        certainty: parsed.value.certainty,
        signals: parsed.value.signals,
        ...(parsed.value.detectedLanguage === undefined
          ? {}
          : { detectedLanguage: parsed.value.detectedLanguage }),
        // `since` marks when this state BEGAN. Resetting it on every read would
        // make "has been panicked for four minutes" unanswerable.
        since: changed ? now : current.since,
        updatedAt: now,
      },
      parsed.latencyMs,
    );
  }

  // --- Translation ----------------------------------------------------------

  async translate(text: string, to: Language, _preserveTone: true): Promise<ToolResult<string>> {
    const parsed = await this.call(
      'translate',
      translationSchema,
      TRANSLATE_PROMPT,
      JSON.stringify({ text, targetLanguage: to }),
    );

    if (parsed.value === undefined) {
      return this.degrade(
        await this.fallback.translate(text, to, true),
        'groq.translate',
        parsed.latencyMs,
      );
    }
    return liveResult(parsed.value.text, parsed.latencyMs);
  }

  // --- Injury photo (5.7) ---------------------------------------------------

  async describeInjuryPhoto(imageRef: string): Promise<ToolResult<PhotoObservation>> {
    const parsed = await this.call(
      'describe_injury_photo',
      photoObservationSchema,
      DESCRIBE_INJURY_PHOTO_PROMPT,
      undefined,
      // Vision takes a different model and a content-parts message shape.
      {
        model: this.config.visionModel,
        content: [
          { type: 'text', text: 'Describe what is visible in this injury photograph.' },
          { type: 'image_url', image_url: { url: imageRef } },
        ],
      },
    );

    if (parsed.value === undefined) {
      return this.degrade(
        await this.fallback.describeInjuryPhoto(imageRef),
        'groq.describe_injury_photo',
        parsed.latencyMs,
      );
    }
    return liveResult(parsed.value, parsed.latencyMs);
  }

  // --- Patient-facing message ----------------------------------------------

  async composeResponse(request: {
    readonly state: { readonly communication: CommunicationRead };
    readonly intent: string;
    readonly maxSentenceWords: number;
    readonly language: Language;
  }): Promise<ToolResult<string>> {
    const parsed = await this.call(
      'compose_response',
      composedResponseSchema,
      COMPOSE_RESPONSE_PROMPT,
      JSON.stringify({
        intent: request.intent,
        maxSentenceWords: request.maxSentenceWords,
        language: request.language,
        communicationState: request.state.communication.state,
      }),
    );

    if (parsed.value === undefined) {
      return this.degrade(
        await this.fallback.composeResponse(
          request as Parameters<ReasoningPort['composeResponse']>[0],
        ),
        'groq.compose_response',
        parsed.latencyMs,
      );
    }

    // 8 requires every message in an active emergency to end with a concrete
    // next step. The schema guarantees the field exists; this guarantees it is
    // actually shown rather than generated and dropped.
    const { message, nextStep } = parsed.value;
    const text = message.includes(nextStep) ? message : `${message} ${nextStep}`;
    return liveResult(text, parsed.latencyMs);
  }

  // --- Plumbing -------------------------------------------------------------

  /**
   * One Groq call: structured output requested, response validated, and
   * `undefined` returned on any failure so each caller takes its fallback path
   * through a single explicit branch.
   */
  private async call<T>(
    schemaName: SchemaName,
    schema: z.ZodType<T>,
    systemPrompt: string,
    userJson: string | undefined,
    vision?: { model: string; content: unknown },
  ): Promise<{ value: T | undefined; latencyMs: number }> {
    const outcome = await requestJsonWithKeys<ChatCompletion>(
      `${this.config.baseUrl}/chat/completions`,
      this.config.apiKeys,
      (apiKey) => ({
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: vision?.model ?? this.config.textModel,
          // Deterministic-leaning. This is not a creative writing task, and a
          // demo that picks a different question each run is hard to rehearse.
          temperature: 0.2,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: schemaName,
              strict: true,
              schema: GROQ_JSON_SCHEMAS[schemaName],
            },
          },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: vision?.content ?? userJson ?? '{}' },
          ],
        }),
      }),
    );

    if (!outcome.ok || outcome.value === undefined) {
      return { value: undefined, latencyMs: outcome.latencyMs };
    }

    const content = outcome.value.choices?.[0]?.message?.content;
    if (content === undefined) return { value: undefined, latencyMs: outcome.latencyMs };

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return { value: undefined, latencyMs: outcome.latencyMs };
    }

    // THE VERIFICATION GATE. No coercion, no partial salvage.
    //
    // `dropNulls` is the one permitted normalisation, and it is a protocol
    // detail rather than a salvage attempt: Groq's strict mode forbids omitting
    // a declared property, so genuinely optional fields arrive as an explicit
    // null. Converting null to absent restores the shape zod describes. It
    // cannot rescue a malformed response - a null in a REQUIRED field still
    // fails validation, because that field is not optional in zod either.
    const validated = schema.safeParse(dropNulls(raw));
    return {
      value: validated.success ? validated.data : undefined,
      latencyMs: outcome.latencyMs,
    };
  }

  /**
   * Re-labels a fallback port's result as degraded.
   *
   * The stand-in returns `liveResult` because from its own perspective it
   * succeeded. From the system's perspective it did not: Groq was asked and
   * could not answer. Without this, a Groq outage would look identical to a
   * healthy call in the tool ledger and on screen - the exact silent
   * degradation section 6 forbids.
   */
  private degrade<T>(
    inner: ToolResult<T>,
    tool: string,
    latencyMs: number,
  ): ToolResult<T> {
    if (!inner.ok) return inner;
    return fallbackResult(inner.data, latencyMs, {
      tool,
      reason: 'unavailable',
      userFacingMessage: REDUCED_MODE_MESSAGE,
      fallbackUsed: 'deterministic question and phrasing stand-in',
      conservative: true,
    });
  }
}

/** Recursively removes keys whose value is null. See the call site for why. */
function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, dropNulls(v)]),
  );
}

/** The patient's own recent words, for context. Capped - prompts stay small. */
function recentPatientWords(request: QuestionSelectionRequest): readonly string[] {
  return request.state.evidence
    .slice(-6)
    .map((e) => e.rawText)
    .filter((w): w is string => typeof w === 'string' && w.length > 0);
}
