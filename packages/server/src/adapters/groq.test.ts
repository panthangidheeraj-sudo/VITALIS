/**
 * Groq adapter tests.
 *
 * The interesting cases are not "does it parse a good response" - they are the
 * three ways a language model damages a clinical system: it returns something
 * the schema rejects, it invents identifiers, and it quietly stops being
 * available halfway through an interview. All three are asserted here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualClock, MockReasoningPort, freshCaseState } from '@triage/agent';
import type { CaseState, EvidenceItem } from '@triage/shared';
import { asEvidenceId, degradationOf } from '@triage/shared';
import { GroqReasoningPort } from './groq-reasoning-port.js';
import { ALL_PROMPTS, NEVER_SCORE_CLAUSE } from './groq-prompts.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const CONFIG = {
  apiKeys: ['test-key'],
  baseUrl: 'https://groq.test/v1',
  textModel: 'text-model',
  visionModel: 'vision-model',
};

function port(): GroqReasoningPort {
  return new GroqReasoningPort(CONFIG, new MockReasoningPort(new ManualClock()));
}

/** Stubs one chat completion whose `content` is the given JSON string. */
function stubCompletion(content: string, status = 200): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch;
}

function stubTransportFailure(): void {
  globalThis.fetch = vi.fn(async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
}

function evidence(id: string, concept: string): EvidenceItem {
  return {
    id: asEvidenceId(id),
    conceptId: concept as EvidenceItem['conceptId'],
    conceptType: 'symptom',
    name: concept,
    choiceId: 'present',
    source: 'initial_complaint',
    reliability: 'reported',
    observedAt: '2026-09-12T07:00:00.000Z',
  } as EvidenceItem;
}

function stateWithEvidence(items: readonly EvidenceItem[]): CaseState {
  return { ...freshCaseState(), evidence: items };
}

// ---------------------------------------------------------------------------

describe('the section 6 boundary: the model cannot score', () => {
  /**
   * Three layers guard this. The schemas are asserted elsewhere
   * (groq-outputs.test.ts); this asserts the prose layer, because a model told
   * to be helpful will write "this sounds serious" into a free-text rationale
   * even when the schema has nowhere to put a tier.
   */
  it('every prompt carries the never-score clause', () => {
    const prompts = Object.entries(ALL_PROMPTS);
    expect(prompts.length).toBe(6);
    for (const [name, text] of prompts) {
      expect(text, `${name} is missing the never-score clause`).toContain(NEVER_SCORE_CLAUSE);
    }
  });

  it('the clause names the specific phrases that leak a judgement', () => {
    expect(NEVER_SCORE_CLAUSE).toContain('triage level');
    expect(NEVER_SCORE_CLAUSE).toContain('diagnosis');
    // Free-text fields are the actual leak path, so they are called out by name.
    expect(NEVER_SCORE_CLAUSE).toContain('rationale');
  });
});

describe('the verification gate', () => {
  it('rejects a response that does not match the schema and falls back', async () => {
    // expectedInformationGain out of range, targetConceptIds empty.
    stubCompletion(
      JSON.stringify({
        text: 'Does it hurt?',
        targetConceptIds: [],
        rationale: 'because',
        expectedInformationGain: 42,
        language: 'en',
        hardToDeflect: false,
      }),
    );

    const result = await port().selectNextQuestion({
      state: freshCaseState(),
      candidateConceptIds: ['s_21' as never],
      requireHardToDeflect: false,
      language: 'en',
    });

    // Not coerced, not partially salvaged - the stand-in answers instead.
    expect(result.source).toBe('fallback');
    expect(degradationOf(result)?.conservative).toBe(true);
  });

  it('rejects a non-JSON body rather than throwing', async () => {
    stubCompletion('I am a helpful assistant! Here is my answer:');

    const result = await port().selectNextQuestion({
      state: freshCaseState(),
      candidateConceptIds: ['s_21' as never],
      requireHardToDeflect: false,
      language: 'en',
    });
    expect(result.source).toBe('fallback');
  });
});

describe('question selection', () => {
  const validQuestion = JSON.stringify({
    text: 'How many steps can you take before you have to stop?',
    targetConceptIds: ['s_21'],
    rationale: 'Exertional tolerance narrows the remaining uncertainty most.',
    expectedInformationGain: 0.7,
    language: 'en',
    hardToDeflect: true,
  });

  it('returns a validated question as a live result', async () => {
    stubCompletion(validQuestion);
    const result = await port().selectNextQuestion({
      state: freshCaseState(),
      candidateConceptIds: ['s_21' as never],
      requireHardToDeflect: true,
      language: 'en',
    });

    expect(result.source).toBe('live');
    if (!result.ok) return;
    expect(result.data.text).toContain('steps');
  });

  /**
   * The policy decides when a question must be hard to deflect. If the model
   * returns false while the policy demanded true, the policy wins - otherwise a
   * model that ignored the instruction also gets to overwrite the record saying
   * it had, and the confidence-alert path silently weakens.
   */
  it('does not let the model downgrade a policy-required hard-to-deflect question', async () => {
    stubCompletion(
      JSON.stringify({
        text: 'Is your breathing okay?',
        targetConceptIds: ['s_21'],
        rationale: 'checking',
        expectedInformationGain: 0.3,
        language: 'en',
        hardToDeflect: false,
      }),
    );

    const result = await port().selectNextQuestion({
      state: freshCaseState(),
      candidateConceptIds: ['s_21' as never],
      requireHardToDeflect: true,
      language: 'en',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hardToDeflect).toBe(true);
  });
});

describe('contradiction detection', () => {
  it('drops conflicts that cite evidence ids which do not exist', async () => {
    stubCompletion(
      JSON.stringify({
        contradictions: [
          {
            kind: 'cross_turn_reversal',
            detail: 'real conflict',
            conflictingEvidenceIds: ['ev_1', 'ev_2'],
            certainty: 0.8,
          },
          {
            kind: 'cross_turn_reversal',
            detail: 'hallucinated',
            conflictingEvidenceIds: ['ev_1', 'ev_999'],
            certainty: 0.9,
          },
        ],
      }),
    );

    const state = stateWithEvidence([evidence('ev_1', 's_21'), evidence('ev_2', 's_21')]);
    const result = await port().detectContradiction({
      state,
      newInputText: 'actually it does not hurt',
      newEvidence: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // An invented id would produce a contradiction the policy can never
    // resolve, permanently blocking routing on this case.
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.detail).toBe('real conflict');
  });

  it('treats an empty list as a normal, successful answer', async () => {
    stubCompletion(JSON.stringify({ contradictions: [] }));
    const result = await port().detectContradiction({
      state: stateWithEvidence([evidence('ev_1', 's_21')]),
      newInputText: 'it still hurts',
      newEvidence: [],
    });

    expect(result.source).toBe('live');
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });
});

describe('degradation', () => {
  /**
   * The whole reason the stand-in is injected rather than replaced: a free-tier
   * rate limit mid-interview must not stop the interview.
   */
  it('continues the interview through a transport failure', async () => {
    stubTransportFailure();

    const result = await port().selectNextQuestion({
      state: freshCaseState(),
      candidateConceptIds: ['s_21' as never],
      requireHardToDeflect: false,
      language: 'en',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text.length).toBeGreaterThan(0);
  });

  it('marks the fallback as degraded so it is not mistaken for a live call', async () => {
    stubTransportFailure();
    const result = await port().selectNextQuestion({
      state: freshCaseState(),
      candidateConceptIds: ['s_21' as never],
      requireHardToDeflect: false,
      language: 'en',
    });

    // The stand-in reports its own result as live, because from its point of
    // view it succeeded. The adapter re-labels it - otherwise a Groq outage is
    // indistinguishable from a healthy call in the ledger and on screen.
    expect(result.source).toBe('fallback');
    const notice = degradationOf(result);
    expect(notice?.userFacingMessage).toContain('simpler script');
    expect(notice?.userFacingMessage).toContain('risk assessment is unaffected');
  });

  it('degrades a 429 rate limit rather than failing the turn', async () => {
    stubCompletion('', 429);
    const result = await port().readCommunicationState(['help'], {
      state: 'neutral',
      certainty: 0,
      signals: [],
      since: '2026-09-12T07:00:00.000Z',
      updatedAt: '2026-09-12T07:00:00.000Z',
    });
    expect(result.source).toBe('fallback');
  });
});

describe('composed responses', () => {
  it('guarantees the next step is actually shown, not just generated', async () => {
    stubCompletion(
      JSON.stringify({
        message: 'An ambulance is on the way.',
        nextStep: 'Unlock your front door now.',
        language: 'en',
      }),
    );

    const result = await port().composeResponse({
      state: freshCaseState(),
      intent: 'confirm dispatch',
      maxSentenceWords: 12,
      language: 'en',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Section 8: every message in an active emergency ends with a concrete
    // step. The schema guarantees the field exists; this guarantees it is not
    // generated and then dropped on the floor.
    expect(result.data).toContain('Unlock your front door now.');
  });

  it('does not duplicate a next step already present in the message', async () => {
    stubCompletion(
      JSON.stringify({
        message: 'Help is coming. Unlock your front door now.',
        nextStep: 'Unlock your front door now.',
        language: 'en',
      }),
    );

    const result = await port().composeResponse({
      state: freshCaseState(),
      intent: 'confirm dispatch',
      maxSentenceWords: 12,
      language: 'en',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.match(/Unlock your front door now\./g)).toHaveLength(1);
  });
});
