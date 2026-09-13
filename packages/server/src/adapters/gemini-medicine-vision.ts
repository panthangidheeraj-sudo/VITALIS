/**
 * Medicine-pack photo identification — reuses the SAME Gemini vision
 * configuration/credential as gemini-vision-port.ts's injury-photo
 * description (same `GEMINI_API_KEY`, same base URL, same vision model).
 * Deliberately a SEPARATE small function rather than a new method on
 * `GeminiVisionPort`/`ReasoningPort`: that interface is the triage loop's
 * port and every method on it is something the ODAEA loop can call
 * mid-interview. Identifying a medicine from a photo is not a triage
 * action - it has nothing to do with a case, evidence, or risk - so it gets
 * its own tiny surface instead of widening a port that would give the loop
 * a capability it was never meant to have. Same architectural call as
 * `groq-chat-port.ts` earlier in this codebase, for the same reason.
 *
 * THE MEDICAL SAFETY RULE THIS EXISTS TO ENFORCE: never invent an expiry
 * date, never fabricate a name from an unreadable photo. The prompt and the
 * schema both make "not clearly visible" a normal, expected answer rather
 * than something the model has to fight the schema to say - `expiryDate`
 * and `productName` are both nullable, and `confidence` is required
 * precisely so a low-confidence guess can never look identical to a
 * confident read on the wire.
 */

import type { GeminiConfig } from './gemini-vision-port.js';
import { requestJson } from './http.js';

export interface MedicineIdentification {
  readonly productName: string | undefined;
  readonly strength: string | undefined;
  readonly expiryDateText: string | undefined;
  readonly manufacturer: string | undefined;
  /** 0-1. Low confidence is a valid, expected, non-error outcome. */
  readonly confidence: number;
  /** Always present. States plainly what could and could not be read. */
  readonly notes: string;
}

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  }[];
}

const MEDICINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    productName: { type: 'STRING', nullable: true },
    strength: { type: 'STRING', nullable: true },
    expiryDateText: { type: 'STRING', nullable: true },
    manufacturer: { type: 'STRING', nullable: true },
    confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
    notes: { type: 'STRING' },
  },
  required: ['confidence', 'notes'],
} as const;

const PROMPT = `You are reading a photograph of a medicine package (box, blister strip, or bottle label) for a patient. Extract ONLY what is actually legible in the image.

Rules, no exceptions:
- If the product name is not clearly legible, set productName to null. Never guess a plausible-sounding drug name.
- If an expiry date is not clearly legible or is ambiguous (smudged, cropped, wrong format), set expiryDateText to null and say so in notes. NEVER invent or estimate a date - a wrong expiry claim is a real safety hazard.
- strength/manufacturer: null if not clearly visible.
- confidence is your OWN honest 0-1 estimate of how reliable this whole reading is, not just whether you produced an answer.
- notes must state plainly which fields you could not read, e.g. "Expiry date not clearly visible - please verify from the package." Always mention anything uncertain.
- Never diagnose, never suggest a dose, never comment on whether the medicine is safe to take.`;

const DATA_URL = /^data:(image\/[a-z+]+);base64,(.+)$/i;

export async function identifyMedicine(
  config: GeminiConfig,
  imageRef: string,
): Promise<{ readonly ok: true; readonly data: MedicineIdentification } | { readonly ok: false; readonly message: string }> {
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
              { text: 'Read this medicine package photo and extract what is legible.' },
              { inlineData: { mimeType: match[1], data: match[2] } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: MEDICINE_SCHEMA },
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
  const confidence = typeof r['confidence'] === 'number' ? Math.min(1, Math.max(0, r['confidence'])) : 0;
  const notes = typeof r['notes'] === 'string' && r['notes'].length > 0 ? r['notes'] : 'No details returned.';

  return {
    ok: true,
    data: {
      productName: typeof r['productName'] === 'string' ? r['productName'] : undefined,
      strength: typeof r['strength'] === 'string' ? r['strength'] : undefined,
      expiryDateText: typeof r['expiryDateText'] === 'string' ? r['expiryDateText'] : undefined,
      manufacturer: typeof r['manufacturer'] === 'string' ? r['manufacturer'] : undefined,
      confidence,
      notes,
    },
  };
}
