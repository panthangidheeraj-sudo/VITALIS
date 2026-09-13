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
import type { KnowledgePort } from '@triage/shared';
import type { ChatTurn, GroqChatPort } from '../adapters/groq-chat-port.js';

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
export function createAssistantRoutes(chatPort: GroqChatPort | undefined, knowledge: KnowledgePort): Router {
  const router = Router();

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
