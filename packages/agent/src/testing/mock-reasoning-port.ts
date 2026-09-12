/**
 * A deterministic stand-in for Groq. Two of its methods are more than dumb
 * stubs, on purpose:
 *
 *   - `detectContradiction` reads the `supersedes` link `apply-evidence.ts`
 *     already attached to any evidence item whose answer just flipped, and
 *     classifies the conflict from the two items' `source`/`reliability`.
 *     This is a reasonable stand-in for what an LLM call would actually be
 *     asked to notice, and it keeps the orchestrator tests deterministic
 *     without needing to script a contradiction by hand for every scenario.
 *   - `readCommunicationState` applies a crude length/punctuation heuristic —
 *     real classification is Groq's job; this exists so terse-vs-articulate
 *     branches in the loop are exercisable in a test.
 *
 * Everything else is a fixed, valid response — the orchestrator tests are not
 * about phrasing quality, they are about whether the loop calls the right
 * tool at the right time and reacts correctly to what comes back.
 */

import type {
  CaseState,
  ClockPort,
  CommunicationRead,
  CommunicationState,
  ContradictionCheckRequest,
  Contradiction,
  PhotoObservation,
  QuestionSelectionRequest,
  ReasoningPort,
  SelectedQuestion,
  ToolResult,
} from '@triage/shared';
import { liveResult } from '@triage/shared';

export class MockReasoningPort implements ReasoningPort {
  constructor(private readonly clock: Pick<ClockPort, 'now'>) {}

  async selectNextQuestion(
    request: QuestionSelectionRequest,
  ): Promise<ToolResult<SelectedQuestion>> {
    const target = request.candidateConceptIds[0] ?? 's_999';
    const question: SelectedQuestion = {
      text: request.requireHardToDeflect
        ? `I want to check something specific — has anything changed about ${target}?`
        : `Can you tell me more about ${target}?`,
      targetConceptIds: [target],
      rationale: request.requireHardToDeflect
        ? 'Confidence alert is active; phrasing is harder to deflect than a yes/no.'
        : 'Highest-uncertainty active concept.',
      expectedInformationGain: 0.6,
      language: request.language,
      hardToDeflect: request.requireHardToDeflect,
    };
    return liveResult(question, 1);
  }

  async detectContradiction(
    request: ContradictionCheckRequest,
  ): Promise<ToolResult<readonly Contradiction[]>> {
    const now = this.clock.now();
    const contradictions: Contradiction[] = [];

    for (const item of request.newEvidence) {
      if (item.supersedes === undefined) continue;
      const prior = request.state.evidence.find((e) => e.id === item.supersedes);
      if (prior === undefined) continue;

      const isProxyOverridingReport =
        prior.source !== item.source &&
        (item.source === 'caregiver_report' || item.reliability === 'measured');

      contradictions.push({
        kind: isProxyOverridingReport ? 'self_report_vs_evidence' : 'cross_turn_reversal',
        detail: `${item.conceptId} was "${prior.choiceId}" (${prior.source}) at ${prior.observedAt}; now "${item.choiceId}" (${item.source}).`,
        conflictingEvidenceIds: [prior.id, item.id],
        detectedAt: now,
      });
    }

    return liveResult(contradictions, 2);
  }

  async readCommunicationState(
    recentInputs: readonly string[],
    current: CommunicationRead,
  ): Promise<ToolResult<CommunicationRead>> {
    const joined = recentInputs.join(' ');
    const avgLen = recentInputs.length > 0 ? joined.length / recentInputs.length : 0;

    let state: CommunicationState = current.state;
    if (/[A-Z]{4,}|!{2,}|please help/i.test(joined)) {
      state = 'panicked';
    } else if (avgLen > 0 && avgLen < 16) {
      state = 'terse';
    } else if (avgLen >= 60) {
      state = 'articulate';
    }

    const read: CommunicationRead = {
      state,
      certainty: 0.7,
      signals: state === 'terse' ? ['very_short_answers'] : [],
      since: current.since,
      updatedAt: this.clock.now(),
    };
    return liveResult(read, 1);
  }

  async translate(text: string, to: SelectedQuestion['language']): Promise<ToolResult<string>> {
    // No real translation in the mock — round-trips the text unchanged.
    void to;
    return liveResult(text, 1);
  }

  async describeInjuryPhoto(imageRef: string): Promise<ToolResult<PhotoObservation>> {
    void imageRef;
    return liveResult(
      {
        visibleSigns: ['bleeding'],
        description: 'Mock observation: visible bleeding on the forearm.',
        suggestedConceptTerms: ['bleeding'],
        imageQuality: 0.8,
      },
      1,
    );
  }

  async composeResponse(request: {
    readonly state: CaseState;
    readonly intent: string;
    readonly maxSentenceWords: number;
    readonly language: SelectedQuestion['language'];
  }): Promise<ToolResult<string>> {
    void request;
    return liveResult('Understood. What happens next?', 1);
  }
}
