/**
 * Persistence wrapper around `orchestrateTurn`.
 *
 * `orchestrateTurn` is pure with respect to the store — it takes a `CaseState`
 * and returns a new one, and never touches Firestore. This is the one place
 * that does: it reads the current document, runs the loop, and writes the
 * result back with an optimistic-concurrency check (`CaseState.revision`).
 *
 * WHY THIS MATTERS HERE SPECIFICALLY: Companion Mode ticks and a live patient
 * answer can arrive within the same few seconds of each other. Without a
 * revision check, whichever write lands second silently overwrites the
 * first — which in this domain means a genuinely reported symptom vanishing
 * from the record because a background tick happened to save a stale copy
 * over it. `RevisionConflictError` from @triage/shared is what a bare
 * `store.update` throws when that race is caught; this wrapper retries once
 * by re-reading and re-running the loop against the fresh state, which is
 * safe because `orchestrateTurn` only ever reads the state it is handed.
 */

import type { AgentTools, CaseId, CaseState, TimelineEntry, ToolCallRecord, Turn, TurnInput } from '@triage/shared';
import { RevisionConflictError } from '@triage/shared';
import { orchestrateTurn } from './orchestrator.js';

export interface RunTurnResult {
  readonly state: CaseState;
  readonly turn: Turn;
}

export class CaseNotFoundError extends Error {
  constructor(readonly caseId: CaseId) {
    super(`No case found for id ${caseId}.`);
    this.name = 'CaseNotFoundError';
  }
}

async function persist(
  tools: AgentTools,
  caseId: CaseId,
  expectedRevision: number,
  nextState: CaseState,
  timeline: readonly TimelineEntry[],
  toolCalls: readonly ToolCallRecord[],
  turn: Turn,
): Promise<void> {
  const toWrite: CaseState = { ...nextState, revision: expectedRevision + 1 };
  await tools.store.update(caseId, expectedRevision, toWrite);
  if (timeline.length > 0) await tools.store.appendTimeline(caseId, timeline);
  for (const call of toolCalls) await tools.store.appendToolCall(caseId, call);
  await tools.store.saveTurn(caseId, turn.id, turn);
}

export async function runTurn(
  caseId: CaseId,
  input: TurnInput,
  tools: AgentTools,
  attemptsRemaining = 2,
): Promise<RunTurnResult> {
  const state = await tools.store.get(caseId);
  if (state === undefined) throw new CaseNotFoundError(caseId);

  const { nextState, turn, timeline, toolCalls } = await orchestrateTurn(state, input, tools);

  try {
    await persist(tools, caseId, state.revision, nextState, timeline, toolCalls, turn);
    return { state: { ...nextState, revision: state.revision + 1 }, turn };
  } catch (err) {
    if (err instanceof RevisionConflictError && attemptsRemaining > 1) {
      // Someone else's write landed first (a Companion Mode tick, most
      // likely). Re-read and re-run against the fresh state rather than
      // forcing the write — forcing it is exactly the lost-update bug this
      // whole mechanism exists to prevent.
      return runTurn(caseId, input, tools, attemptsRemaining - 1);
    }
    throw err;
  }
}
