/**
 * End-to-end walk through the six-beat scenario (spec §11), against the loop's
 * real code — not the hand-authored fixture in @triage/shared, which is a
 * target shape, not a code path. This test drives `orchestrateTurn` turn by
 * turn with a scriptable-but-deterministic tool set and checks that the
 * mechanics actually produce the behaviour the demo depends on: evidence
 * accumulates, a contradiction blocks and then requires INDEPENDENT
 * confirmation to clear, risk escalates live, and a confirmed decision
 * triggers hospital matching and dispatch.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { RISK_TIER_RANK, activeEvidence } from '@triage/shared';
import type { LexiconEntry } from '../testing/mock-normalization-port.js';
import { buildTestTools, freshCaseState, type TestHarness } from '../testing/build-tools.js';
import { confirmRouting } from './confirm-routing.js';
import { orchestrateTurn } from './orchestrator.js';

const LEXICON: readonly LexiconEntry[] = [
  { match: 'heavy feeling in my chest', id: 's_21', type: 'symptom', name: 'Chest pain', commonName: 'chest pain', choiceId: 'present' },
  { match: 'not sweating', id: 's_47', type: 'symptom', name: 'Excessive sweating', commonName: 'sweating', choiceId: 'absent' },
  { match: 'drenched in sweat', id: 's_47', type: 'symptom', name: 'Excessive sweating', commonName: 'sweating', choiceId: 'present' },
  { match: 'actually i have been sweating', id: 's_47', type: 'symptom', name: 'Excessive sweating', commonName: 'sweating', choiceId: 'present' },
  { match: 'going down my left arm', id: 's_98', type: 'symptom', name: 'Pain radiating to the left arm', commonName: 'arm pain', choiceId: 'present' },
  { match: "can't breathe", id: 's_13', type: 'symptom', name: 'Dyspnea', commonName: 'shortness of breath', choiceId: 'present' },
];

let h: TestHarness;

beforeEach(() => {
  h = buildTestTools(LEXICON);
});

/**
 * The default harness scores with `LocalDeterministicScorer`, which is always
 * `source: 'local_fallback'` by definition (see that file) — correct for
 * testing the degraded path, but it means a red tier always forces
 * escalation (policy: red + degraded scoring => escalate, never
 * autonomously propose ambulance dispatch on an unvalidated score). The
 * six-beat demo assumes a WORKING Infermedica connection reaching a
 * confirmable decision, so this test's main walkthrough swaps in a
 * live-like stand-in — same present-symptom-count table, but marked
 * `source: 'infermedica'` — while the dedicated escalation test below keeps
 * the real default to exercise the opposite path.
 */
function withLiveLikeScorer(harness: TestHarness) {
  return {
    ...harness.tools,
    risk: {
      async score(request: { readonly evidence: readonly { readonly id: string; readonly choice_id: string }[] }) {
        const present = request.evidence.filter(
          (e) => e.choice_id === 'present' && e.id.startsWith('s_'),
        ).length;
        const triageLevel =
          present >= 4
            ? ('emergency_ambulance' as const)
            : present === 3
              ? ('emergency' as const)
              : present === 2
                ? ('consultation_24' as const)
                : present === 1
                  ? ('consultation' as const)
                  : ('self_care' as const);
        const tier =
          triageLevel === 'emergency_ambulance' || triageLevel === 'emergency'
            ? ('red' as const)
            : triageLevel === 'self_care'
              ? ('green' as const)
              : ('yellow' as const);
        return {
          ok: true as const,
          source: 'live' as const,
          data: {
            tier,
            triageLevel,
            seriousFlags: [],
            triageTuples: [],
            source: 'infermedica' as const,
            evidenceCount: request.evidence.length,
            computedAt: harness.clock.now(),
          },
          latencyMs: 5,
        };
      },
    },
  };
}

describe('six-beat scenario, driven through the real orchestrator', () => {
  it('walks the whole trace end to end', async () => {
    let state = freshCaseState();
    const tools = withLiveLikeScorer(h);

    // --- Beat 1: GOAL — incomplete state, one initial complaint -----------
    const t1 = await orchestrateTurn(
      state,
      { kind: 'text', text: 'I have a heavy feeling in my chest', receivedAt: h.clock.now() },
      tools,
    );
    state = t1.nextState;
    expect(activeEvidence(state.evidence)).toHaveLength(1);
    expect(state.evidence[0]!.source).toBe('initial_complaint');

    // --- Beat 2: DECISION — not enough evidence yet, agent asks a question -
    expect(t1.turn.decidedAction).toBe('ask_question');
    expect(t1.turn.question).toBeDefined();
    expect(t1.timeline.some((e) => e.kind === 'question_asked')).toBe(true);

    // --- Turn 2: a second symptom, evidence floor reached -------------------
    h.clock.advanceSeconds(30);
    const t2 = await orchestrateTurn(
      state,
      { kind: 'text', text: 'no, not sweating', receivedAt: h.clock.now() },
      tools,
    );
    state = t2.nextState;
    expect(activeEvidence(state.evidence)).toHaveLength(2);
    // Enough evidence now, no contradiction yet: the loop scores and moves
    // toward a routing recommendation rather than asking forever.
    expect(t2.timeline.some((e) => e.kind === 'risk_scored')).toBe(true);
    expect(['propose_routing', 'ask_question']).toContain(t2.turn.decidedAction);

    // --- Turn 3: caregiver reports the OPPOSITE of what the patient said ----
    h.clock.advanceSeconds(150); // ~07:03
    const t3 = await orchestrateTurn(
      state,
      {
        kind: 'text',
        text: 'he is drenched in sweat',
        fromCaregiver: true,
        receivedAt: h.clock.now(),
      },
      tools,
    );
    state = t3.nextState;

    // The self-report ("not sweating") is superseded, never deleted.
    const denied = state.evidence.find((e) => e.rawText === 'no, not sweating');
    const observed = state.evidence.find((e) => e.rawText === 'he is drenched in sweat');
    expect(denied?.supersededBy).toBe(observed?.id);
    expect(activeEvidence(state.evidence).some((e) => e.id === denied?.id)).toBe(false);

    // A Confidence Alert fires and BLOCKS routing — this is the headline
    // behaviour from spec §2/§5.1.
    expect(state.confidence.alertActive).toBe(true);
    expect(state.confidence.contradictions.some((c) => c.kind === 'self_report_vs_evidence')).toBe(
      true,
    );
    expect(t3.turn.decidedAction).toBe('probe_contradiction');
    expect(t3.turn.question?.hardToDeflect).toBe(true);

    // Any earlier tentative routing proposal is reopened, not left dangling —
    // the agent must not show a decision built on evidence it just disputed.
    expect(state.status).toBe('interviewing');
    expect(state.routing).toBeUndefined();

    // This is the ADAPTATION beat: the plan changed, and the record says why.
    expect(t3.turn.adaptation).toBeDefined();
    expect(t3.turn.adaptation?.trigger).toBe('contradiction_detected');
    expect(t3.timeline.some((e) => e.kind === 'confidence_alert_raised')).toBe(true);

    // --- Turn 3.5: the caregiver's report ALONE must not settle it ---------
    // Regression guard for the exact bug this design fixes: resolving a
    // contradiction with the very evidence that raised it would let the
    // agent take a single contested claim at face value instead of probing —
    // the opposite of what §5.1 requires.
    expect(state.confidence.contradictions.find((c) => c.kind === 'self_report_vs_evidence')?.resolvedAt).toBeUndefined();

    // --- Turn 4: the patient independently confirms it directly ------------
    h.clock.advanceSeconds(30);
    const t4 = await orchestrateTurn(
      state,
      { kind: 'text', text: 'actually I have been sweating a lot', receivedAt: h.clock.now() },
      tools,
    );
    state = t4.nextState;

    expect(state.confidence.alertActive).toBe(false);
    const resolved = state.confidence.contradictions.find((c) => c.kind === 'self_report_vs_evidence');
    expect(resolved?.resolvedAt).toBeDefined();
    expect(resolved?.resolutionNote).toContain('independent confirmation');
    expect(t4.timeline.some((e) => e.kind === 'confidence_alert_cleared')).toBe(true);

    // --- Turn 5: a genuinely new, more serious symptom ----------------------
    h.clock.advanceSeconds(120); // ~07:07
    const t5 = await orchestrateTurn(
      state,
      { kind: 'text', text: "now it's going down my left arm", receivedAt: h.clock.now() },
      tools,
    );
    state = t5.nextState;
    expect(t5.timeline.some((e) => e.kind === 'symptom_reported' || e.kind === 'risk_scored')).toBe(
      true,
    );

    // --- Turn 6: shortness of breath — risk must never go DOWN from here ----
    h.clock.advanceSeconds(60);
    const tierBeforeFinalSymptom = state.risk.tier;
    const t6 = await orchestrateTurn(
      state,
      { kind: 'text', text: "i cant breathe", receivedAt: h.clock.now() },
      tools,
    );
    state = t6.nextState;

    // Use the shared ranking rather than a local copy: a local table silently
    // stops covering the tier set the moment a tier is added.
    expect(RISK_TIER_RANK[state.risk.tier]).toBeGreaterThanOrEqual(
      RISK_TIER_RANK[tierBeforeFinalSymptom],
    );
    expect(state.risk.tier).toBe('red');
    expect(state.risk.source).toBe('infermedica'); // live-like scorer in this test

    // --- Beat 6: FINAL OUTCOME — a decision was proposed, verified, gated ---
    expect(state.routing).toBeDefined();
    if (state.routing !== undefined) {
      expect(state.routing.outcome).not.toBe('self_care_guidance'); // red tier can never self-care
      expect(state.status).toBe('awaiting_confirmation');

      // Simulate the safety gate being satisfied (a completed 3-second hold,
      // or an explicit confirm) and confirm the decision.
      const gateSatisfiedState = {
        ...state,
        routing: { ...state.routing, gate: { ...state.routing.gate, state: 'satisfied' as const } },
        lastKnownLocation: {
          lat: 20.2961,
          lng: 85.8245,
          at: h.clock.now(),
          source: 'fixture' as const,
        },
      };
      const confirmResult = await confirmRouting(gateSatisfiedState, tools, h.clock.now());

      expect(confirmResult.nextState.status).toBe('action_taken');
      expect(confirmResult.timeline.some((e) => e.kind === 'routing_confirmed')).toBe(true);

      if (confirmResult.nextState.routing?.outcome === 'ambulance_dispatch') {
        expect(confirmResult.nextState.dispatch.status).toBe('dispatch_requested');
        expect(confirmResult.timeline.some((e) => e.kind === 'dispatch_requested')).toBe(true);
      }
      // Hospital matching runs for any transport-requiring outcome.
      if (confirmResult.nextState.routing?.outcome !== 'primary_care_24h') {
        expect(confirmResult.nextState.hospital).toBeDefined();
        expect(confirmResult.timeline.some((e) => e.kind === 'hospital_matched')).toBe(true);
      }
    }

    // --- Ledger sanity: real, multi-tool interaction happened across turns --
    const allToolCalls = [t1, t2, t3, t4, t5, t6].flatMap((t) => t.toolCalls);
    const toolsUsed = new Set(allToolCalls.map((c) => c.tool));
    expect(toolsUsed.has('infermedica.parse')).toBe(true);
    expect(toolsUsed.has('infermedica.triage')).toBe(true);
    expect(toolsUsed.has('groq.detect_contradiction')).toBe(true);
    expect(toolsUsed.has('groq.select_next_question')).toBe(true);
    // The model never appears as the source of a risk tier change.
    const riskEntries = [t1, t2, t3, t4, t5, t6].flatMap((t) =>
      t.timeline.filter((e) => e.kind === 'risk_tier_changed' || e.kind === 'risk_scored'),
    );
    for (const call of allToolCalls.filter((c) => c.tool.startsWith('groq.'))) {
      expect(call.resultDigest ?? '').not.toMatch(/tier=|triage_level=/);
    }
    expect(riskEntries.length).toBeGreaterThan(0);
  });
});

describe('escalation rather than invented certainty', () => {
  it('escalates instead of proposing a routing decision it cannot verify as safe', async () => {
    let state = freshCaseState({ ageYears: 70 });

    const texts = [
      "I have a heavy feeling in my chest",
      "now it's going down my left arm",
      "i cant breathe",
    ];
    for (const text of texts) {
      h.clock.advanceSeconds(30);
      const result = await orchestrateTurn(state, { kind: 'text', text, receivedAt: h.clock.now() }, h.tools);
      state = result.nextState;
    }

    // Local fallback scoring on a red-tier case is exactly the condition
    // mustEscalateUnresolved treats as too uncertain to act on autonomously.
    expect(state.risk.source).toBe('local_fallback');
    if (state.risk.tier === 'red') {
      expect(state.escalation.escalated).toBe(true);
      expect(state.status).toBe('escalated');
    }
  });
});

describe('tool ports stay swappable', () => {
  it('runs the identical orchestrator against a hand-rolled risk port', async () => {
    const customHarness = buildTestTools(LEXICON);
    let callCount = 0;
    const tools = {
      ...customHarness.tools,
      risk: {
        async score() {
          callCount += 1;
          return {
            ok: true as const,
            source: 'live' as const,
            data: {
              tier: 'yellow' as const,
              triageLevel: 'consultation_24' as const,
              seriousFlags: [],
              triageTuples: [],
              source: 'infermedica' as const,
              evidenceCount: 2,
              computedAt: customHarness.clock.now(),
            },
            latencyMs: 5,
          };
        },
      },
    };

    let state = freshCaseState();
    state = (
      await orchestrateTurn(
        state,
        { kind: 'text', text: 'I have a heavy feeling in my chest', receivedAt: customHarness.clock.now() },
        tools,
      )
    ).nextState;
    customHarness.clock.advanceSeconds(10);
    const result = await orchestrateTurn(
      state,
      { kind: 'text', text: 'no, not sweating', receivedAt: customHarness.clock.now() },
      tools,
    );

    expect(callCount).toBe(1);
    expect(result.nextState.risk.source).toBe('infermedica');
    expect(result.nextState.risk.tier).toBe('yellow');
  });
});
