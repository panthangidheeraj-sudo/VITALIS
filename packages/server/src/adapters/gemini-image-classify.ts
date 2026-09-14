/**
 * "What kind of photo is this?" — the router for the Assistant's single camera
 * button, so the user never has to tell the app in advance whether they are
 * photographing a medicine box or their own hand.
 *
 * Deliberately a SEPARATE, tiny call rather than a field bolted onto the
 * medicine or injury prompts: those two prompts are written to be maximally
 * strict about their own domain (never invent an expiry date; never name a
 * condition), and asking either of them to also consider "…unless this is
 * actually the other thing" is how a prompt starts hedging on the rules that
 * matter. This one answers one question, with a closed vocabulary.
 *
 * It classifies only. It never extracts, never describes an injury, and never
 * reads a label — whichever specialised path it selects does that, with its
 * own schema-validated gate. Same Gemini credential/model as both.
 */

import type { GeminiConfig } from './gemini-vision-port.js';
import { requestJson } from './http.js';

export type ImageKind = 'medicine' | 'injury' | 'other';

export interface ImageClassification {
  readonly kind: ImageKind;
  /** 0–1, the model's own confidence in the ROUTING decision, not in content. */
  readonly confidence: number;
  /** One short line, shown to the user when the answer is `other`. */
  readonly reason: string;
}

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  }[];
}

const CLASSIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['medicine', 'injury', 'other'] },
    confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
    reason: { type: 'STRING' },
  },
  required: ['kind', 'confidence', 'reason'],
} as const;

const PROMPT = `Classify a single photograph into exactly one category. Do not describe, diagnose, or extract anything.

- "medicine": a medicine package, box, blister strip, bottle, tube, or printed label for a drug or supplement.
- "injury": a part of a human body showing a possible injury or skin problem - a wound, cut, burn, bruise, swelling, rash, bite, or similar.
- "other": anything else, including a photo too dark/blurry to tell, a document, a screen, food, or an unrelated object.

Rules:
- If it is a body part with no visible problem at all, still answer "injury" - the injury path is what handles "nothing visible".
- If a medicine package is being held in a hand, that is "medicine", not "injury".
- confidence is your own honest 0-1 estimate that this ROUTING is correct.
- reason: one short sentence, plain language, for a patient to read.`;

const DATA_URL = /^data:(image\/[a-z+]+);base64,(.+)$/i;

export async function classifyImage(
  config: GeminiConfig,
  imageRef: string,
): Promise<{ readonly ok: true; readonly data: ImageClassification } | { readonly ok: false; readonly message: string }> {
  const match = DATA_URL.exec(imageRef);
  if (match === null) {
    return { ok: false, message: 'Photo must be supplied as a base64 data URL.' };
  }

  const outcome = await requestJson<GeminiResponse>(
    `${config.baseUrl}/models/${config.visionModel}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Which category is this photograph?' },
              { inlineData: { mimeType: match[1], data: match[2] } },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: CLASSIFY_SCHEMA },
      }),
    },
  );

  if (!outcome.ok || outcome.value === undefined) {
    return { ok: false, message: outcome.error?.message ?? 'Gemini unreachable.' };
  }

  const text = outcome.value.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text === undefined) {
    return { ok: false, message: 'Gemini returned no content.' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Gemini returned non-JSON.' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'Gemini returned an unexpected shape.' };
  }

  const r = raw as Record<string, unknown>;
  const kind = r['kind'];
  if (kind !== 'medicine' && kind !== 'injury' && kind !== 'other') {
    return { ok: false, message: 'Gemini returned an unknown image category.' };
  }
  return {
    ok: true,
    data: {
      kind,
      confidence: typeof r['confidence'] === 'number' ? Math.min(1, Math.max(0, r['confidence'])) : 0,
      reason: typeof r['reason'] === 'string' && r['reason'].length > 0 ? r['reason'] : 'No detail returned.',
    },
  };
}
