/**
 * General conversational replies for the Assistant screen's chat composer.
 *
 * DELIBERATELY SEPARATE FROM `GroqReasoningPort`. That port's contract is
 * triage-specific and every method returns a JSON-schema-constrained,
 * zod-validated shape — question selection, contradiction detection, and so
 * on. None of that applies to "how are you" or "what is metformin for". This
 * is a plain chat-completion call with a free-text response, because widening
 * `ReasoningPort` to cover open-ended conversation would give the LLM a
 * surface it was never meant to have near the triage loop.
 *
 * IT STILL CANNOT SET A RISK TIER. Nothing in this file writes to a
 * `CaseState`, calls the scorer, or reaches the routing/dispatch machinery —
 * this only ever produces a sentence to show in the chat thread. The client
 * decides, via its own local keyword gate, whether a message escalates to a
 * real case; this port is never consulted for that decision and has no way
 * to be.
 */

import { requestJson } from './http.js';

export interface GroqChatConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly textModel: string;
}

interface ChatCompletion {
  readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
}

export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

const SYSTEM_PROMPT = `You are the Vitalis Assistant, a friendly, capable conversational assistant inside an emergency-triage app.

You may answer general and conversational questions directly and naturally, using your own knowledge — small talk ("how are you"), general explanations, questions about readings or medication, anything a helpful assistant would answer.

When a REFERENCE SNIPPET is provided below, ground your medical answer in it and end with a short "(Source: <name>)" citation. Do not invent a citation if none is provided — answer from your own general knowledge instead, and do not claim it came from a named medical database.

Hard rules, always:
- You are decision support, not a diagnosis. Never diagnose a condition, never prescribe or recommend a specific dose of medication.
- If the message describes a symptom or emergency actually happening right now, say plainly that this should be tracked properly and that you can start a case for it — but do not refuse to also give a short, calm, helpful answer in the same reply.
- Keep replies short: 1-4 sentences. This is a chat composer, not an essay.
- Never say you "cannot answer general health questions" or that you are "not wired to a knowledge endpoint" — that is no longer true; you can and should answer.`;

export class GroqChatPort {
  constructor(private readonly config: GroqChatConfig) {}

  /**
   * `grounding` is the best-effort MedlinePlus/Wikipedia snippet the route
   * looked up before calling this — see `routes/assistant.ts`. Absent when
   * no knowledge source matched, in which case the model answers from its
   * own general knowledge and says so implicitly by citing nothing.
   */
  async reply(input: {
    readonly message: string;
    readonly history: readonly ChatTurn[];
    readonly grounding?: { readonly text: string; readonly citationLabel: string };
  }): Promise<{ readonly ok: true; readonly reply: string } | { readonly ok: false; readonly message: string }> {
    const groundingBlock =
      input.grounding === undefined
        ? ''
        : `\n\nREFERENCE SNIPPET (source: ${input.grounding.citationLabel}):\n${input.grounding.text}`;

    const outcome = await requestJson<ChatCompletion>(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.textModel,
        // Warmer than the triage-loop calls (0.2): this is conversation, not
        // a rehearsed demo trace, and a flat, repetitive tone reads as canned.
        temperature: 0.5,
        max_tokens: 300,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}${groundingBlock}` },
          ...input.history.slice(-8),
          { role: 'user', content: input.message },
        ],
      }),
    });

    if (!outcome.ok || outcome.value === undefined) {
      return { ok: false, message: 'Groq is unavailable right now.' };
    }
    const content = outcome.value.choices?.[0]?.message?.content;
    if (content === undefined || content.trim().length === 0) {
      return { ok: false, message: 'Groq returned an empty reply.' };
    }
    return { ok: true, reply: content.trim() };
  }
}
