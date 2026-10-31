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

import type { ToolErrorKind } from '@triage/shared';
import type { GeminiConfig } from './gemini-vision-port.js';
import { createHash } from 'node:crypto';
import { requestJsonWithKeys, VISION_POLICY } from './http.js';

/**
 * Why a failure carries a KIND and not just a sentence.
 *
 * "Could not read that photo" is the correct thing to tell someone whose photo
 * was blurry. It is the WRONG thing to tell someone whose photo was perfect and
 * whose server had simply run out of Gemini quota — that hides an operational
 * problem behind a message blaming the user's camera, and the operator never
 * finds out. Verified in production: the deployed scanner was returning
 * "could not be read" for an HTTP 429 `RESOURCE_EXHAUSTED`.
 *
 * The kind comes straight from `http.ts`'s existing classification, so a 429 is
 * a 429 all the way up to the route that phrases it.
 */
export interface VisionFailure {
  readonly ok: false;
  readonly message: string;
  readonly kind: ToolErrorKind;
}

/** A stable code the UI can branch on, alongside the sentence. */
export type VisionFailureReason = 'rate_limited' | 'not_configured' | 'bad_image' | 'unavailable';

/**
 * Turns an internal failure into something safe AND accurate to show a user.
 *
 * Safe: no URL, no key, no status code, no upstream prose — the raw message is
 * logged server-side instead.
 *
 * Accurate: each class says what actually went wrong. Telling someone their
 * photo was unreadable when the server hit its daily Gemini quota sends them
 * off to retake a perfectly good photo, repeatedly, while the real fix is an
 * API plan. That was the live behaviour this function exists to end.
 */
export function describeVisionFailure(kind: ToolErrorKind): {
  readonly reason: VisionFailureReason;
  readonly message: string;
} {
  switch (kind) {
    case 'rate_limited':
      return {
        reason: 'rate_limited',
        message:
          'Photo analysis has reached its limit for now — this is a limit on the VITALIS server, not a problem with your photo. Please try again later.',
      };
    case 'unauthorized':
      return {
        reason: 'not_configured',
        message: 'Photo analysis is not set up correctly on this server. Your photo was fine — this needs an administrator.',
      };
    case 'bad_request':
      return {
        reason: 'bad_image',
        message: 'That image format could not be read. Try a JPG or PNG photo.',
      };
    default:
      return {
        reason: 'unavailable',
        message: 'That photo could not be read right now. Please try again in a moment.',
      };
  }
}

export interface MedicineIdentification {
  /** What the photo IS — decided in the same call, so no separate classify request is needed. */
  readonly imageKind: 'medicine' | 'injury' | 'other';
  readonly productName: string | undefined;
  /** The active-ingredient name if printed on the pack (brands usually print it). */
  readonly genericName: string | undefined;
  readonly strength: string | undefined;
  /** Tablet, capsule, syrup, injection, cream… when stated on the pack. */
  readonly dosageForm: string | undefined;
  readonly expiryDateText: string | undefined;
  /** True when more than one date is printed and which is the expiry is ambiguous. */
  readonly expiryAmbiguous: boolean;
  readonly manufacturer: string | undefined;
  /**
   * LAST-RESORT uses text, from the model's own knowledge. The route prefers
   * MedlinePlus/RxNorm (see medicine-info.ts) and only falls back to this when
   * no trusted source had anything — and labels it as such when it does.
   */
  readonly usesAndBenefits: string | undefined;
  readonly cautions: string | undefined;
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
    imageKind: { type: 'STRING', enum: ['medicine', 'injury', 'other'] },
    productName: { type: 'STRING', nullable: true },
    genericName: { type: 'STRING', nullable: true },
    strength: { type: 'STRING', nullable: true },
    dosageForm: { type: 'STRING', nullable: true },
    expiryDateText: { type: 'STRING', nullable: true },
    expiryAmbiguous: { type: 'BOOLEAN' },
    manufacturer: { type: 'STRING', nullable: true },
    usesAndBenefits: { type: 'STRING', nullable: true },
    cautions: { type: 'STRING', nullable: true },
    confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
    notes: { type: 'STRING' },
  },
  required: ['imageKind', 'confidence', 'notes', 'expiryAmbiguous'],
} as const;

const PROMPT = `First decide imageKind: "medicine" if the photo shows a medicine package, strip, sachet, bottle or loose tablets; "injury" if it mainly shows a part of a person's body with a wound, burn, swelling, rash or similar; "other" for anything else (objects, documents, scenery). A package may be photographed upside down or at an angle — still "medicine" if it is one; read it as best you can. For "injury" and "other", leave every other field null, set confidence to how sure you are of the imageKind, and say in notes what the photo shows.

You are reading a photograph of a medicine package (box, blister strip, sachet or bottle label) for a patient. Extract ONLY what is actually legible in the image, except for uses and cautions where you can use your medical knowledge based on the identified product name.

Rules, no exceptions:
- If the product name is not clearly legible, set productName to null. Never guess a plausible-sounding drug name.
- genericName: the active ingredient if it is PRINTED on the pack (e.g. "Paracetamol" under the brand "Dolo"). Null if not printed - do not supply it from memory.
- If an expiry date is not clearly legible, set expiryDateText to null and say so in notes. NEVER invent or estimate a date - a wrong expiry claim is a real safety hazard.
- Packs often print BOTH a manufacture date and an expiry date. Only return a date you can see is the EXPIRY (labelled EXP, Exp. Date, Use by, Best before). If two or more dates are printed and you cannot tell which is the expiry, set expiryDateText to null AND expiryAmbiguous to true, and say in notes that several dates are printed and the user must check the pack.
- expiryAmbiguous is false in every other case.
- strength/dosageForm/manufacturer: null if not clearly visible.
- usesAndBenefits: a brief, plain summary of what this medicine is COMMONLY USED FOR, from the identified product name. Phrase as "commonly used for" / "used to help manage" - never as a cure or a promise. Null if the product name is unknown.
- cautions: a brief summary of common warnings or cautions. Null if the product name is unknown.
- confidence is your OWN honest 0-1 estimate of how reliable this whole reading is, not just whether you produced an answer.
- notes must state plainly which fields you could not read, e.g. "Expiry date not clearly visible - please verify from the package." Always mention anything uncertain.
- Never diagnose, never suggest a dose, never say a medicine is safe for this person.`;

/**
 * Same photo, same answer, no second request.
 *
 * Free-tier Gemini is ~20 requests/day, and the most common way to burn them
 * is retrying: a failed or doubtful scan makes people press "Scan another"
 * with the same pack, and re-picking the same file sends the identical bytes.
 * Only SUCCESSES are cached (a failure must stay retryable), keyed by a hash
 * of the exact image, held in memory for an hour and capped so a long-lived
 * process cannot grow without bound. Lost on restart, which is fine: it is a
 * quota saver, not a store.
 */
const RESULT_CACHE = new Map<string, { at: number; data: MedicineIdentification }>();
const RESULT_CACHE_TTL_MS = 60 * 60 * 1000;
const RESULT_CACHE_MAX = 40;

const DATA_URL = /^data:(image\/[a-z+]+);base64,(.+)$/i;

export async function identifyMedicine(
  config: GeminiConfig,
  imageRef: string,
): Promise<{ readonly ok: true; readonly data: MedicineIdentification } | VisionFailure> {
  const match = DATA_URL.exec(imageRef);
  if (match === null) {
    return { ok: false, message: 'Photo must be supplied as a base64 data URL.', kind: 'bad_request' };
  }

  const cacheKey = createHash('sha256').update(imageRef).digest('hex');
  const hit = RESULT_CACHE.get(cacheKey);
  if (hit !== undefined && Date.now() - hit.at < RESULT_CACHE_TTL_MS) return { ok: true, data: hit.data };

  const outcome = await requestJsonWithKeys<GeminiResponse>(
    (key) => `${config.baseUrl}/models/${config.visionModel}:generateContent?key=${encodeURIComponent(key)}`,
    [config.apiKey, ...(config.spareKeys ?? [])],
    () => ({
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
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: MEDICINE_SCHEMA,
          // Reading a label is transcription, not reasoning. Verified against
          // the live model: a budget of 0 is accepted and produces no hidden
          // "thought" tokens, which otherwise count against both the output
          // budget and the request's latency.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      policy: VISION_POLICY,
    }),
  );

  if (!outcome.ok || outcome.value === undefined) {
    // The kind carries 429/401/timeout up to the route, which is what stops
    // a quota failure being phrased as an unreadable photo.
    return {
      ok: false,
      message: outcome.error?.message ?? 'Gemini unreachable.',
      kind: outcome.error?.kind ?? 'unavailable',
    };
  }

  const text = outcome.value.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text === undefined) {
    return { ok: false, message: 'Gemini returned no content.', kind: 'invalid_response' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Gemini returned non-JSON.', kind: 'invalid_response' };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'Gemini returned an unexpected shape.', kind: 'invalid_response' };
  }
  const r = raw as Record<string, unknown>;
  const confidence = typeof r['confidence'] === 'number' ? Math.min(1, Math.max(0, r['confidence'])) : 0;
  const notes = typeof r['notes'] === 'string' && r['notes'].length > 0 ? r['notes'] : 'No details returned.';

  const data: MedicineIdentification = {
      imageKind: r['imageKind'] === 'injury' || r['imageKind'] === 'other' ? r['imageKind'] : 'medicine',
      productName: typeof r['productName'] === 'string' ? r['productName'] : undefined,
      genericName: typeof r['genericName'] === 'string' ? r['genericName'] : undefined,
      strength: typeof r['strength'] === 'string' ? r['strength'] : undefined,
      dosageForm: typeof r['dosageForm'] === 'string' ? r['dosageForm'] : undefined,
      expiryDateText: typeof r['expiryDateText'] === 'string' ? r['expiryDateText'] : undefined,
      expiryAmbiguous: r['expiryAmbiguous'] === true,
      manufacturer: typeof r['manufacturer'] === 'string' ? r['manufacturer'] : undefined,
      usesAndBenefits: typeof r['usesAndBenefits'] === 'string' ? r['usesAndBenefits'] : undefined,
      cautions: typeof r['cautions'] === 'string' ? r['cautions'] : undefined,
      confidence,
      notes,
  };
  RESULT_CACHE.set(cacheKey, { at: Date.now(), data });
  if (RESULT_CACHE.size > RESULT_CACHE_MAX) RESULT_CACHE.delete(RESULT_CACHE.keys().next().value as string);
  return { ok: true, data };
}
