/**
 * The revision-checked persistence wrapper. The scenario this guards against:
 * a Companion Mode tick and a live patient answer landing within the same
 * window. Whichever writes second must not silently clobber the first.
 */

import { describe, expect, it } from 'vitest';
import type { CaseState } from '@triage/shared';
import { asCaseId, requiredGate, RevisionConflictError } from '@triage/shared';
import { buildTestTools, freshCaseState } from '../testing/build-tools.js';
import { CaseNotFoundError, runTurn } from './run-turn.js';

const LEXICON = [
  { match: 'chest', id: 's_21', type: 'symptom' as const, name: 'Chest pain', choiceId: 'present' as const },
];

describe('runTurn', () => {
  it('throws CaseNotFoundError for an unknown case id', async () => {
    const { tools } = buildTestTools(LEXICON);
    await expect(
      runTurn(asCaseId('does_not_exist'), { kind: 'text', text: 'chest pain', receivedAt: '2026-09-12T07:00:00.000Z' }, tools),
    ).rejects.toBeInstanceOf(CaseNotFoundError);
  });

  it('persists the turn and bumps the revision by exactly one', async () => {
    const { tools, store } = buildTestTools(LEXICON);
    const initial = freshCaseState();
    store.seed(initial);

    const result = await runTurn(initial.caseId, { kind: 'text', text: 'chest pain', receivedAt: '2026-09-12T07:00:00.000Z' }, tools);

    expect(result.state.revision).toBe(initial.revision + 1);
    const stored = await store.get(initial.caseId);
    expect(stored?.revision).toBe(initial.revision + 1);
    expect(stored?.turnCount).toBe(1);

    const timeline = await store.listTimeline(initial.caseId);
    expect(timeline.length).toBeGreaterThan(0);
    const calls = await store.listToolCalls(initial.caseId);
    expect(calls.some((c) => c.tool === 'infermedica.parse')).toBe(true);
  });

  it('retries against fresh state when a concurrent write wins the race', async () => {
    const { tools, store } = buildTestTools(LEXICON);
    const initial = freshCaseState();
    store.seed(initial);

    // Simulate a concurrent writer (e.g. a Companion Mode tick) landing first
    // by bumping the revision out from under the in-flight call, exactly once.
    const realUpdate = store.update.bind(store);
    let interceptOnce = true;
    store.update = async (caseId, expectedRevision, next) => {
      if (interceptOnce) {
        interceptOnce = false;
        // Land a competing write at the revision runTurn is about to use.
        await realUpdate(caseId, expectedRevision, { ...next, turnCount: 999 });
        throw new RevisionConflictError(caseId, expectedRevision, expectedRevision + 1);
      }
      return realUpdate(caseId, expectedRevision, next);
    };

    const result = await runTurn(initial.caseId, { kind: 'text', text: 'chest pain', receivedAt: '2026-09-12T07:00:00.000Z' }, tools);

    // The retry re-read the post-collision state (turnCount 999) and built on
    // top of it, rather than throwing or silently overwriting it.
    expect(result.state.turnCount).toBe(1000);
  });

  it('gives up after exhausting retries rather than looping forever', async () => {
    const { tools, store } = buildTestTools(LEXICON);
    const initial = freshCaseState();
    store.seed(initial);

    store.update = async (caseId, expectedRevision) => {
      throw new RevisionConflictError(caseId, expectedRevision, expectedRevision + 1);
    };

    await expect(
      runTurn(initial.caseId, { kind: 'text', text: 'chest pain', receivedAt: '2026-09-12T07:00:00.000Z' }, tools),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
});

describe('a case that has already acted does not rewind', () => {
  /**
   * Found by driving the real server: after a confirmed ambulance dispatch,
   * submitting an injury photo returned the case to `awaiting_confirmation`
   * while `dispatch.status` still read `dispatch_requested`. The screen then
   * asks the patient to hold the button to request an ambulance that is
   * already coming.
   */
  it('keeps action_taken and the confirmed routing across a later turn', async () => {
    const { tools, store } = buildTestTools(LEXICON);
    const now = tools.clock.now();
    const seeded: CaseState = {
      ...freshCaseState(),
      caseId: asCaseId('case_acted'),
      status: 'action_taken',
      dispatch: { status: 'dispatch_requested', simulated: true, requestedAt: now },
      routing: {
        outcome: 'ambulance_dispatch',
        rationale: 'confirmed already',
        policyRule: 'baseOutcomeByTriageLevel',
        gate: { ...requiredGate('ambulance_dispatch'), state: 'satisfied', satisfiedAt: now },
        proposedAt: now,
        basedOnRiskComputedAt: now,
        confirmedAt: now,
      },
    };
    store.seed(seeded);

    const result = await runTurn(
      seeded.caseId,
      { kind: 'text', text: 'I also feel sick', receivedAt: tools.clock.now() },
      tools,
    );

    expect(result.state.status).toBe('action_taken');
    expect(result.state.routing?.confirmedAt).toBeDefined();
    // But the record still moves — freezing the whole case would hide a
    // patient getting worse, which is the opposite of the intent.
    expect(result.state.turnCount).toBe(seeded.turnCount + 1);
    expect(result.state.evidence.length).toBeGreaterThanOrEqual(seeded.evidence.length);
  });
});
