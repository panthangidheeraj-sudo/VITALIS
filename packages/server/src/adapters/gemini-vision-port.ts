/**
 * Google Gemini - the vision half of ReasoningPort.
 *
 * WHY A SECOND MODEL PROVIDER AT ALL: the Groq account has no vision-capable
 * model, so 5.7 injury photo assessment and the medicine scanner's camera path
 * were both wired-but-dead. Gemini supplies vision only. Groq keeps every
 * text task - question selection, contradiction detection, tone, translation -
 * because there is no reason to move working code.
 *
 * COMPOSITION, NOT REPLACEMENT. This class wraps an existing ReasoningPort and
 * overrides exactly one method. Everything else is delegated untouched, so
 * adding Gemini cannot change how questions are chosen or how contradictions
 * are detected - a change in those would be invisible here and very visible in
 * the demo.
 *
 * THE 6 BOUNDARY APPLIES IDENTICALLY. Gemini describes what is VISIBLE. It
 * does not name a condition and it cannot produce a risk tier: the method
 * returns a `PhotoObservation`, whose schema has nowhere to put one, and the
 * prompt forbids it in prose. A photo is one more observation for the rule
 * engine to score, never a shortcut past it.
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
import { VISIBLE_SIGNS, failedResult, liveResult, photoObservationSchema } from '@triage/shared';
import { requestJson } from './http.js';
import { DESCRIBE_INJURY_PHOTO_PROMPT } from './groq-prompts.js';

export interface GeminiConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly visionModel: string;
}

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  }[];
}

/**
 * Gemini's own JSON-mode schema dialect. Close to JSON Schema but not
 * identical - it wants uppercase type names and has no `additionalProperties`,
 * so the shared GROQ_JSON_SCHEMAS entry cannot be reused verbatim. Declared
 * here beside the only call that uses it.
 */
const PHOTO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    // The enum is spread from the SHARED constant, not retyped. The first
    // version of this file said `type: STRING` here while the zod gate demanded
    // one of thirteen enum members, so the model's honest answers ("dark red
    // diagonal line") failed validation and the photo contributed nothing at
    // all - a silent capability loss with a green banner above it. Constraining
    // the provider schema means the model is told the vocabulary rather than
    // being marked wrong for not guessing it.
    visibleSigns: { type: 'ARRAY', items: { type: 'STRING', enum: VISIBLE_SIGNS } },
    description: { type: 'STRING' },
    suggestedConceptTerms: { type: 'ARRAY', items: { type: 'STRING' } },
    // Gemini has returned `2` for this field when the range was only stated in
    // the prompt. The bound is restated here, and zod still rejects an
    // out-of-range value - a confidence number that is silently wrong is worse
    // than a missing photo.
    imageQuality: { type: 'NUMBER', minimum: 0, maximum: 1 },
  },
  required: ['visibleSigns', 'description', 'suggestedConceptTerms', 'imageQuality'],
} as const;

/** Matches `data:image/jpeg;base64,...` as sent from the device. */
const DATA_URL = /^data:(image\/[a-z+]+);base64,(.+)$/i;

export class GeminiVisionPort implements ReasoningPort {
  constructor(
    private readonly config: GeminiConfig,
    /** Every non-vision method is delegated to this, unchanged. */
    private readonly text: ReasoningPort,
  ) {}

  async describeInjuryPhoto(imageRef: string): Promise<ToolResult<PhotoObservation>> {
    const match = DATA_URL.exec(imageRef);
    if (match === null) {
      // The device sends inline image data. A bare reference would mean the
      // image lives somewhere this server cannot read, which is a wiring bug
      // rather than a model failure - so say that, do not call the API.
      return failedResult(
        {
          kind: 'bad_request',
          message: 'Photo must be supplied as a base64 data URL.',
          retryable: false,
        },
        0,
        this.degradation(),
      );
    }

    const outcome = await requestJson<GeminiResponse>(
      `${this.config.baseUrl}/models/${this.config.visionModel}:generateContent` +
        `?key=${encodeURIComponent(this.config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: DESCRIBE_INJURY_PHOTO_PROMPT }] },
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'Describe what is visible in this photograph of an injury.' },
                { inlineData: { mimeType: match[1], data: match[2] } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: PHOTO_SCHEMA,
          },
        }),
      },
    );

    if (!outcome.ok || outcome.value === undefined) {
      return failedResult(
        outcome.error ?? { kind: 'unavailable', message: 'Gemini unreachable.', retryable: true },
        outcome.latencyMs,
        this.degradation(),
      );
    }

    const text = outcome.value.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text === undefined) {
      return failedResult(
        { kind: 'invalid_response', message: 'Gemini returned no content.', retryable: true },
        outcome.latencyMs,
        this.degradation(),
      );
    }

    // Same verification gate as every Groq call: parsed, validated, or refused.
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return failedResult(
        { kind: 'invalid_response', message: 'Gemini returned non-JSON.', retryable: false },
        outcome.latencyMs,
        this.degradation(),
      );
    }

    const validated = photoObservationSchema.safeParse(raw);
    if (!validated.success) {
      return failedResult(
        {
          kind: 'invalid_response',
          message: `Photo description failed validation: ${validated.error.issues[0]?.message ?? 'unknown'}`,
          retryable: false,
        },
        outcome.latencyMs,
        this.degradation(),
      );
    }

    // NO CITATION, deliberately. `Citation.provider` is a closed set of
    // knowledge sources - MedlinePlus, RxNorm, ICD-11 - and attaching any of
    // them to a model's image description would assert a provenance that does
    // not exist. A model looking at a photo is not a cited source, and the
    // handoff card renders uncited claims as uncited (7).
    return liveResult(validated.data, outcome.latencyMs);
  }

  /**
   * Losing the photo costs the assessment nothing - it was always an EXTRA
   * observation, never a required one - and the message says so, because a
   * patient told "photo analysis failed" with no context reasonably assumes
   * their assessment is now wrong.
   */
  private degradation() {
    return {
      tool: 'groq.describe_injury_photo',
      reason: 'unavailable' as const,
      userFacingMessage:
        'I could not read the photo. Describe what you can see instead - your assessment does not depend on the image.',
      fallbackUsed: 'no photo observation added to the case',
      conservative: true,
    };
  }

  // --- Everything else is delegated verbatim --------------------------------

  selectNextQuestion(r: QuestionSelectionRequest): Promise<ToolResult<SelectedQuestion>> {
    return this.text.selectNextQuestion(r);
  }

  detectContradiction(r: ContradictionCheckRequest): Promise<ToolResult<readonly Contradiction[]>> {
    return this.text.detectContradiction(r);
  }

  readCommunicationState(
    recentInputs: readonly string[],
    current: CommunicationRead,
  ): Promise<ToolResult<CommunicationRead>> {
    return this.text.readCommunicationState(recentInputs, current);
  }

  translate(text: string, to: Language, preserveTone: true): Promise<ToolResult<string>> {
    return this.text.translate(text, to, preserveTone);
  }

  composeResponse(
    request: Parameters<ReasoningPort['composeResponse']>[0],
  ): Promise<ToolResult<string>> {
    return this.text.composeResponse(request);
  }
}
