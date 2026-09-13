/**
 * Companion Mode (§5.4) — the behaviour that separates "an agent" from "a form
 * that submitted".
 *
 * These tests exist because the loop half of this feature was written months
 * before anything called it: `runCompanionTick` was correct, tested, and
 * unreachable, because no case ever set `companion.active` and no timer ever
 * fired. Unit-testing the tick again would have kept passing while the feature
 * stayed dead, so every test here goes through the SCHEDULER — the part that
 * was missing — and the first one asserts the activation that made the rest
 * reachable at all.
 */

import { describe, expect, it } from 'vitest';
import type { AgentTools, CaseState } from '@triage/shared';
import { asCaseId, asUid, requiredGate } from '@triage/shared';
import {
  InMemoryCaseStore,
  LocalDeterministicScorer,
  ManualClock,
  MockCodingPort,
  MockHospitalPort,
  MockKnowledgePort,
  MockMedicationPort,
  MockNormalizationPort,
  MockNotificationPort,
  MockReasoningPort,
  SequentialIdPort,
  confirmRouting,
  freshCaseState,
} from '@triage/agent';
import { CompanionScheduler } from './scheduler.js';
import { DEMO_LEXICON } from '../tools/demo-lexicon.js';

function build(): { tools: AgentTools; store: InMemoryCaseStore; clock: ManualClock } {
  const clock = new ManualClock();
  const store = new InMemoryCaseStore();
  return {
    clock,
    store,
    tools: {
      clock,
      ids: new SequentialIdPort(),
      risk: new LocalDeterministicScorer(clock),
      normalize: new MockNormalizationPort(DEMO_LEXICON),
      reasoning: new MockReasoningPort(clock),
      knowledge: new MockKnowledgePort(),
      medication: new MockMedicationPort(),
      coding: new MockCodingPort(),
      hospitals: new MockHospitalPort(),
      notifications: new MockNotificationPort(),
      store,
    },
  };
}

function seedConfirmedCase(store: InMemoryCaseStore, tools: AgentTools, id: string): CaseState {
  const now = tools.clock.now();
  const state: CaseState = {
    ...freshCaseState(),
    caseId: asCaseId(id),
    ownerUid: asUid('uid_companion_test'),
    status: 'awaiting_confirmation',
    risk: {
      tier: 'orange',
      triageLevel: 'consultation_24',
      seriousFlags: [],
      triageTuples: [],
      source: 'local_rules',
      evidenceCount: 3,
      computedAt: now,
    },
    routing: {
      outcome: 'urgent_care_now',
      rationale: 'seeded',
      policyRule: 'baseOutcomeByTriageLevel',
      gate: { ...requiredGate('urgent_care_now'), state: 'satisfied', satisfiedAt: now },
      proposedAt: now,
      basedOnRiskComputedAt: now,
    },
  };
  store.seed(state);
  return state;
}

describe('Companion Mode activation (§5.4)', () => {
  /**
   * The single most load-bearing assertion in this file. Before it, every
   * construction site in the codebase set `companion.active: false` and nothing
   * anywhere flipped it — so the scheduler would have swept an empty queue
   * forever and looked exactly like a working system with no patients.
   */
  it('turns itself on when a routing decision is confirmed', async () => {
    const { tools, store } = build();
    const state = seedConfirmedCase(store, tools, 'case_activates');

    const result = await confirmRouting(state, tools, tools.clock.now());

    expect(state.companion.active).toBe(false); // before
    expect(result.nextState.companion.active).toBe(true); // after
    expect(result.nextState.companion.nextReassessmentDueAt).toBeDefined();
  });

  it('schedules the first reassessment one interval out, not immediately', async () => {
    const { tools, store } = build();
    const state = seedConfirmedCase(store, tools, 'case_interval');
    const at = tools.clock.now();

    const result = await confirmRouting(state, tools, at);

    // An instant re-tick would put a meaningless "nothing changed" entry on the
    // timeline directly beneath the decision the patient just made.
    const due = new Date(result.nextState.companion.nextReassessmentDueAt!).getTime();
    expect(due).toBe(new Date(at).getTime() + state.companion.intervalMs);
  });
});

describe('the scheduler sweep', () => {
  it('does not tick a case whose reassessment is not due yet', async () => {
    const { tools, store } = build();
    const state = seedConfirmedCase(store, tools, 'case_not_due');
    const confirmed = await confirmRouting(state, tools, tools.clock.now());
    store.seed({ ...confirmed.nextState, revision: 1 });

    expect(await new CompanionScheduler(tools).sweep()).toBe(0);
  });

  it('ticks once the interval has elapsed, and reschedules itself', async () => {
    const { tools, store, clock } = build();
    const state = seedConfirmedCase(store, tools, 'case_due');
    const confirmed = await confirmRouting(state, tools, tools.clock.now());
    store.seed({ ...confirmed.nextState, revision: 1 });

    clock.advanceMs(state.companion.intervalMs + 1000);
    expect(await new CompanionScheduler(tools).sweep()).toBe(1);

    const after = await store.get(state.caseId);
    expect(after?.companion.reassessmentCount).toBe(1);
    // Rescheduled, not left due — otherwise every subsequent sweep re-ticks the
    // same case and the free-tier quota is gone in a minute.
    expect(after!.companion.nextReassessmentDueAt! > clock.now()).toBe(true);
  });

  it('records every reassessment on the timeline, including "nothing changed"', async () => {
    const { tools, store, clock } = build();
    const state = seedConfirmedCase(store, tools, 'case_timeline');
    const confirmed = await confirmRouting(state, tools, tools.clock.now());
    store.seed({ ...confirmed.nextState, revision: 1 });

    clock.advanceMs(state.companion.intervalMs + 1000);
    await new CompanionScheduler(tools).sweep();

    // §5.4: silence is not a record. A tick that found nothing must still be a
    // timestamped fact a clinician can read afterwards.
    const timeline = await store.listTimeline(state.caseId);
    expect(timeline.some((e) => e.kind === 'companion_reassessment')).toBe(true);
  });

  /**
   * A cancelled alert is over. Continuing to reassess it would keep a closed
   * emergency alive in the due queue — and once notifications are wired to
   * tier changes, would eventually contact a family about it.
   */
  it('leaves cancelled and resolved cases alone', async () => {
    const { tools, store, clock } = build();
    const state = seedConfirmedCase(store, tools, 'case_cancelled');
    const confirmed = await confirmRouting(state, tools, tools.clock.now());
    store.seed({ ...confirmed.nextState, revision: 1, status: 'cancelled' });

    clock.advanceMs(state.companion.intervalMs + 1000);
    expect(await new CompanionScheduler(tools).sweep()).toBe(0);
  });

  it('reports itself unsupported rather than silently never ticking', () => {
    const { tools, store } = build();
    const crippled = {
      ...tools,
      store: Object.assign(Object.create(Object.getPrototypeOf(store) as object), store, {
        listDueCompanionCases: undefined,
      }) as AgentTools['store'],
    };
    // The difference between "no active cases" and "this feature is off" has to
    // be visible; `supported` is what the boot banner reads.
    expect(new CompanionScheduler(crippled).supported).toBe(false);
  });
});
