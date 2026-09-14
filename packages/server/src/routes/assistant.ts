/**
 * General conversational chat for the Assistant screen composer.
 *
 * Not part of `/cases` — this never touches a `CaseState`, the scorer, or
 * routing. It exists purely so the chat composer can answer "how are you" or
 * "what is metformin for" instead of a flat refusal. Whether a message
 * escalates to a real case is decided client-side (a keyword gate in
 * `AssistantScreen.tsx`) BEFORE this route is ever called for that message;
 * this route has no method that could make that call even if asked to.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { KnowledgePort, MedicationPort } from '@triage/shared';
import type { ChatTurn, GroqChatPort } from '../adapters/groq-chat-port.js';
import type { GeminiConfig } from '../adapters/gemini-vision-port.js';
import { classifyImage } from '../adapters/gemini-image-classify.js';
import { describeVisionFailure, identifyMedicine } from '../adapters/gemini-medicine-vision.js';
import { lookupMedicineInfo, USES_CAVEAT } from '../adapters/medicine-info.js';

const imageSchema = z.object({
  /** `data:image/...;base64,...` — bounded by express.json's own 10mb limit. */
  photoRef: z.string().min(1).max(8_000_000),
});

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2000),
      }),
    )
    .max(12)
    .default([]),
});

/**
 * Small talk never gets a knowledge-source lookup. Wikipedia's search
 * returns SOME page for nearly any input string — "hello, how are you?"
 * resolves live to a 1968 Easybeats song rather than nothing (verified
 * against the running server, not assumed) — so searching on every message
 * risks citing a wrong, faintly ridiculous source under a friendly reply.
 * This does not gate whether Groq answers (it always does); it only decides
 * whether it is worth trying to ground the answer in a real source.
 *
 * MATCHES ONE-OR-MORE CASUAL PHRASES, not just a single exact phrase — a
 * plain alternation matched "how are you" but not "hello, how are you?",
 * because the comma splits it into two clauses the old pattern never
 * anchored across. `(PHRASE[\s,!.?]*)+` repeats across punctuation-joined
 * clauses instead.
 */
const CASUAL_PHRASE =
  "(?:hi|hello|hey|yo|hii+|hiya|good\\s?(?:morning|afternoon|evening)|thanks?|thank\\s?you|ty|bye|goodbye|ok|okay|how\\s*(?:are|r)\\s*(?:you|u)(?:\\s*doing)?|what'?s\\s*up|sup|who\\s*are\\s*you)";
const CHITCHAT_PATTERN = new RegExp(`^\\s*(?:${CASUAL_PHRASE}[\\s,!.?]*)+$`, 'i');

/**
 * Guards against a search match that is real but WRONG — verified live: the
 * question "what is metformin used for?" returned a MedlinePlus/Wikipedia
 * hit titled "Semaglutide", a completely different drug, because the search
 * indexes were handed the full question rather than a topic. Full sentences
 * confuse a keyword search; there is no cheap way to extract "the topic" from
 * arbitrary English, so instead the result is sanity-checked after the fact:
 * if no distinctive word (4+ letters) from the matched title appears
 * anywhere in what the user actually typed, the match is almost certainly
 * off-topic and is dropped rather than cited.
 */
function groundingLooksRelevant(message: string, citationTitle: string): boolean {
  const messageLower = message.toLowerCase();
  const titleWords = citationTitle
    .toLowerCase()
    .replace(/^(medlineplus|wikipedia):\s*/, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  if (titleWords.length === 0) return true;
  return titleWords.some((w) => messageLower.includes(w));
}

function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/**
 * `chatPort` is `undefined` when `GROQ_API_KEY` is not set — the route still
 * exists and says so plainly, the same "degrade, never fabricate" pattern
 * every other tool in this codebase follows, rather than returning a canned
 * reply that pretends to be the model.
 */
export function createAssistantRoutes(
  chatPort: GroqChatPort | undefined,
  knowledge: KnowledgePort,
  medication?: MedicationPort,
  gemini?: GeminiConfig,
): Router {
  const router = Router();

  /**
   * The Assistant's camera button posts here. ONE endpoint for both kinds of
   * photo, because the user should not have to declare in advance whether
   * they are photographing a pill packet or their own hand.
   *
   * Medicine is answered here in full. An INJURY IS NOT: this route classifies
   * it and stops, returning `kind: 'injury'` so the client submits the photo
   * as a real `photo` turn on a case. That is deliberate — the injury path
   * must run through the ODAEA loop (`describeInjuryPhoto` → evidence →
   * deterministic scorer → adaptive question), and duplicating any of that
   * here would create a second, unscored route to a risk-bearing answer.
   */
  router.post(
    '/image',
    wrap(async (req: Request, res: Response) => {
      if (gemini === undefined) {
        res.status(503).json({
          error: 'vision_unavailable',
          message: 'Photo analysis needs GEMINI_API_KEY, which is not configured on this server.',
        });
        return;
      }
      const parsed = imageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }

      const classified = await classifyImage(gemini, parsed.data.photoRef);
      if (!classified.ok) {
        // Upstream detail is a server-side diagnostic. It named the provider
        // endpoint and, before http.ts started stripping query strings, the
        // API key with it — so the client gets a plain sentence either way.
        console.warn(`[assistant/image] classify failed (${classified.kind}): ${classified.message}`);
        const described = describeVisionFailure(classified.kind);
        res.status(502).json({ error: 'classify_failed', reason: described.reason, message: described.message });
        return;
      }

      if (classified.data.kind === 'injury') {
        res.json({ kind: 'injury', classification: classified.data });
        return;
      }
      if (classified.data.kind === 'other') {
        res.json({ kind: 'other', classification: classified.data });
        return;
      }

      const identified = await identifyMedicine(gemini, parsed.data.photoRef);
      if (!identified.ok) {
        console.warn(`[assistant/image] identify failed (${identified.kind}): ${identified.message}`);
        const described = describeVisionFailure(identified.kind);
        res.status(502).json({ error: 'identify_failed', reason: described.reason, message: described.message });
        return;
      }
      const medicine = identified.data;

      // Trusted-source enrichment. Only attempted when the pack actually gave
      // us a name to look up — searching NIH for a name we guessed would just
      // launder a guess into a citation.
      const lookupName = medicine.genericName ?? medicine.productName;
      const info =
        lookupName !== undefined && medication !== undefined
          ? await lookupMedicineInfo(lookupName, { medication, knowledge })
          : undefined;

      // Trusted source wins; the vision model's own text is the fallback and
      // is labelled as such on the wire so the UI can say where it came from.
      const uses = info?.uses ?? medicine.usesAndBenefits;
      const usesSource = info?.uses !== undefined ? info.usesSource : medicine.usesAndBenefits !== undefined ? ('model' as const) : undefined;

      // Groq turns the structured facts into one natural sentence. It is given
      // ONLY those facts and told not to add any — presentation, not a second
      // opinion. Failure here is non-fatal: the card carries the data anyway.
      let narrative: string | undefined;
      if (chatPort !== undefined && medicine.productName !== undefined) {
        const facts = [
          `Name: ${medicine.productName}`,
          medicine.genericName !== undefined ? `Generic: ${medicine.genericName}` : undefined,
          info?.genericName !== undefined ? `RxNorm name: ${info.genericName}` : undefined,
          medicine.strength !== undefined ? `Strength: ${medicine.strength}` : undefined,
          medicine.dosageForm !== undefined ? `Form: ${medicine.dosageForm}` : undefined,
          uses !== undefined ? `Commonly used for: ${uses}` : undefined,
          medicine.expiryDateText !== undefined ? `Expiry printed: ${medicine.expiryDateText}` : 'Expiry: not clearly visible',
        ]
          .filter((f): f is string => f !== undefined)
          .join('\n');
        const result = await chatPort
          .reply({
            message: `Summarise this medicine for the patient in at most two short sentences. Use ONLY these facts, add nothing, never say it cures anything, and never suggest a dose. If the expiry was not visible, tell them to check the pack.\n\n${facts}`,
            history: [],
          })
          .catch(() => undefined);
        if (result?.ok === true) narrative = result.reply;
      }

      res.json({
        kind: 'medicine',
        classification: classified.data,
        medicine: {
          productName: medicine.productName,
          genericName: medicine.genericName ?? info?.genericName,
          strength: medicine.strength,
          dosageForm: medicine.dosageForm,
          manufacturer: medicine.manufacturer,
          expiryDateText: medicine.expiryDateText,
          expiryAmbiguous: medicine.expiryAmbiguous,
          confidence: medicine.confidence,
          notes: medicine.notes,
          cautions: medicine.cautions,
          uses,
          usesSource,
          usesCaveat: uses === undefined ? undefined : USES_CAVEAT,
          rxcui: info?.rxcui,
          labelUrl: info?.labelUrl,
          identityConfirmed: medicine.productName !== undefined,
        },
        sources: info?.sources ?? [],
        narrative,
        interactionsChecked: false,
        interactionNotice:
          'Drug interactions are NOT checked. This confirms what a medicine is, not whether it is safe alongside anything else.',
      });
    }),
  );

  router.post(
    '/chat',
    wrap(async (req: Request, res: Response) => {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }

      if (chatPort === undefined) {
        res.status(503).json({
          error: 'chat_unavailable',
          message: 'General chat needs GROQ_API_KEY, which is not configured on this server.',
        });
        return;
      }

      // Best-effort grounding: a knowledge-source miss must never block the
      // conversational reply, only remove the citation from it. Skipped
      // entirely for small talk — see CHITCHAT_PATTERN above.
      const explained = CHITCHAT_PATTERN.test(parsed.data.message)
        ? undefined
        : await knowledge.explain({ name: parsed.data.message }).catch(() => undefined);
      const relevant =
        explained !== undefined &&
        explained.ok &&
        groundingLooksRelevant(parsed.data.message, explained.data.citation.title);
      const grounding =
        relevant && explained !== undefined && explained.ok
          ? { text: explained.data.text, citationLabel: explained.data.citation.title }
          : undefined;

      const history: readonly ChatTurn[] = parsed.data.history.map((h) => ({
        role: h.role,
        content: h.content,
      }));

      const result = await chatPort.reply({
        message: parsed.data.message,
        history,
        ...(grounding === undefined ? {} : { grounding }),
      });
      if (!result.ok) {
        res.status(502).json({ error: 'chat_failed', message: result.message });
        return;
      }

      res.json({
        reply: result.reply,
        citation:
          grounding === undefined
            ? undefined
            : {
                provider: explained?.ok === true ? explained.data.citation.provider : undefined,
                title: explained?.ok === true ? explained.data.citation.title : undefined,
                url: explained?.ok === true ? explained.data.citation.url : undefined,
              },
      });
    }),
  );

  return router;
}
