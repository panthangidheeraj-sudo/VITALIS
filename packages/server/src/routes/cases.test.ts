/**
 * HTTP-level tests against the real Express app on an ephemeral port.
 *
 * The press-and-hold gate gets the most attention here. Spec §5.2 calls it
 * explicitly non-negotiable — "never auto-call on a single tap" — and it is the
 * one safety property that a UI bug, a mistyped constant, or a well-meaning
 * refactor could quietly remove without anything else failing. The unit tests
 * in @triage/shared prove `requiredGate('ambulance_dispatch')` demands a
 * 3-second hold; these prove the SERVER actually enforces it before acting.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentTools, CaseState } from '@triage/shared';
import { PRESS_AND_HOLD_DURATION_MS, asCaseId, requiredGate } from '@triage/shared';
import { InMemoryCaseStore, LocalDeterministicScorer, ManualClock, MockCodingPort, MockHospitalPort, MockKnowledgePort, MockMedicationPort, MockNormalizationPort, MockNotificationPort, MockReasoningPort, SequentialIdPort, freshCaseState } from '@triage/agent';
import { createApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { DEMO_LEXICON } from '../tools/demo-lexicon.js';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  nodeEnv: 'test',
  firebase: { credentialsPath: undefined, projectId: undefined, enabled: false },
  groq: {
    apiKey: undefined,
    baseUrl: 'http://127.0.0.1:9/v1',
    textModel: 'x',
    visionModel: 'y',
    enabled: false,
  },
  infermedica: { appId: undefined, appKey: undefined, baseUrl: '', enabled: false },
  // Unreachable hosts on purpose: these tests build their own tools below and
  // must never touch the network. A real URL here would let a future edit
  // silently start calling NIH from CI.
  icd11: {
    clientId: undefined,
    clientSecret: undefined,
    tokenUrl: 'http://127.0.0.1:9/token',
    baseUrl: 'http://127.0.0.1:9',
    release: undefined,
    enabled: false,
  },
  knowledge: {
    medlinePlusSearchUrl: 'http://127.0.0.1:9/query',
    wikipediaBaseUrl: 'http://127.0.0.1:9',
  },
  rxnav: { baseUrl: 'http://127.0.0.1:9' },
  gemini: {
    apiKey: undefined,
    baseUrl: 'http://127.0.0.1:9',
    visionModel: 'x',
    enabled: false,
  },
  // Credentials absent AND live false: these tests must never be one env var
  // away from texting somebody. The mock notification port is what they get.
  twilio: {
    accountSid: undefined,
    authToken: undefined,
    whatsappFrom: undefined,
    smsFrom: undefined,
    live: false,
    enabled: false,
  },
  osm: { overpassUrl: 'http://127.0.0.1:9/interpreter', contactEmail: undefined },
  forceLocalScorer: true,
};

let server: Server;
let baseUrl: string;
let store: InMemoryCaseStore;
let tools: AgentTools;

beforeAll(async () => {
  const clock = new ManualClock();
  store = new InMemoryCaseStore();
  tools = {
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
  };

  const app = createApp({ tools, config: TEST_CONFIG, firestoreEnabled: false });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const post = (path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

async function newCase(): Promise<string> {
  const res = await post('/cases', { ownerUid: 'uid_test_owner', ageYears: 52, sex: 'male' });
  const body = (await res.json()) as { caseId: string };
  return body.caseId;
}

describe('the press-and-hold gate (§5.2, non-negotiable)', () => {
  /**
   * The case is seeded directly into the state the gate guards, so these tests
   * exercise the GATE rather than the path to it. Driving the interview would
   * couple every gate assertion to the scoring rules, and a rule change would
   * then quietly stop testing the one safety property 5.2 calls
   * non-negotiable.
   */
  async function seedAmbulanceCase(): Promise<string> {
    const caseId = asCaseId(`case_gate_${Math.random().toString(36).slice(2)}`);
    const base = freshCaseState();
    const now = tools.clock.now();
    const seeded: CaseState = {
      ...base,
      caseId,
      status: 'awaiting_confirmation',
      risk: {
        tier: 'red',
        triageLevel: 'emergency_ambulance',
        seriousFlags: [],
        triageTuples: [],
        source: 'infermedica',
        evidenceCount: 4,
        computedAt: now,
      },
      routing: {
        outcome: 'ambulance_dispatch',
        rationale: 'seeded for gate test',
        policyRule: 'baseOutcomeByTriageLevel',
        gate: requiredGate('ambulance_dispatch'),
        proposedAt: now,
        basedOnRiskComputedAt: now,
      },
      lastKnownLocation: { lat: 20.2961, lng: 85.8245, at: now, source: 'fixture' },
    };
    store.seed(seeded);
    return caseId;
  }

  it('refuses to dispatch when the hold was too short', async () => {
    const caseId = await seedAmbulanceCase();
    const res = await post(`/cases/${caseId}/confirm`, { heldMs: 500 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; requiredHoldMs: number };
    expect(body.error).toBe('gate_not_satisfied');
    expect(body.requiredHoldMs).toBe(PRESS_AND_HOLD_DURATION_MS);

    // Nothing happened: no dispatch, status untouched.
    const after = await store.get(asCaseId(caseId));
    expect(after?.dispatch.status).toBe('not_dispatched');
    expect(after?.status).toBe('awaiting_confirmation');
  });

  it('refuses a single tap (heldMs 0) — the accidental-trigger case', async () => {
    const caseId = await seedAmbulanceCase();
    const res = await post(`/cases/${caseId}/confirm`, { heldMs: 0 });
    expect(res.status).toBe(400);
    const after = await store.get(asCaseId(caseId));
    expect(after?.dispatch.status).toBe('not_dispatched');
  });

  it('refuses a hold one millisecond short of the threshold', async () => {
    const caseId = await seedAmbulanceCase();
    const res = await post(`/cases/${caseId}/confirm`, {
      heldMs: PRESS_AND_HOLD_DURATION_MS - 1,
    });
    expect(res.status).toBe(400);
  });

  it('dispatches once the full 3-second hold is met', async () => {
    const caseId = await seedAmbulanceCase();
    const res = await post(`/cases/${caseId}/confirm`, { heldMs: PRESS_AND_HOLD_DURATION_MS });

    expect(res.status).toBe(200);
    const after = await store.get(asCaseId(caseId));
    expect(after?.status).toBe('action_taken');
    expect(after?.dispatch.status).toBe('dispatch_requested');
    expect(after?.routing?.confirmedAt).toBeDefined();
    expect(after?.hospital).toBeDefined(); // hospital matching ran as part of the action
  });

  it('does not require a hold for an outcome whose gate is not press-and-hold', async () => {
    // Symptoms chosen to AVOID the red-flag rules: a headache plus dizziness
    // raises the tier by accumulation, not by a named emergency pattern, so
    // the outcome stays below ambulance dispatch. Chest pain with left-arm
    // radiation would now fire a combination rule and reach press-and-hold.
    const caseId = await newCase();
    await post(`/cases/${caseId}/turns`, { kind: 'text', text: 'I have a headache' });
    await post(`/cases/${caseId}/turns`, { kind: 'text', text: 'i feel dizzy' });

    const state = await store.get(asCaseId(caseId));
    expect(state?.routing?.gate.kind).not.toBe('press_and_hold_3s');

    const res = await post(`/cases/${caseId}/confirm`, { heldMs: 0 });
    expect(res.status).toBe(200);
  });
});

describe('case lifecycle over HTTP', () => {
  it('rejects a malformed create request', async () => {
    const res = await post('/cases', { ownerUid: 'uid_test_owner', ageYears: 'fifty', sex: 'male' });
    expect(res.status).toBe(400);
  });

  /**
   * Without an owner the case is written successfully and is then unreadable by
   * every client, because firebase/firestore.rules matches on `ownerUid`. That
   * failure is invisible at the HTTP layer and shows up only as a live view
   * that never populates, so it is rejected at creation instead.
   */
  it('refuses to create a case with no owner', async () => {
    const res = await post('/cases', { ageYears: 52, sex: 'male' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_request');
  });

  it('persists the owner uid the security rules match on', async () => {
    const caseId = await newCase();
    const state = await store.get(asCaseId(caseId));
    expect(state?.ownerUid).toBe('uid_test_owner');
  });

  it('starts with an incomplete state, as the problem statement requires', async () => {
    const caseId = await newCase();
    const state = await store.get(asCaseId(caseId));
    expect(state?.evidence).toHaveLength(0);
    expect(state?.turnCount).toBe(0);
    expect(state?.status).toBe('interviewing');
  });

  /**
   * Rewritten when the rule engine became primary. This previously asserted
   * that a red case escalated BECAUSE scoring was degraded - which was true
   * only while Infermedica was the intended engine and this one was standing
   * in. Now a red tier is a confident finding, and asserting the old
   * behaviour would have locked in a permanently-lit degradation banner.
   */
  it('reaches red through a named red flag, with no degradation claimed', async () => {
    const caseId = await newCase();
    await post(`/cases/${caseId}/turns`, { kind: 'text', text: 'I have chest pain' });
    await post(`/cases/${caseId}/turns`, { kind: 'text', text: 'pain going down my left arm' });
    const res = await post(`/cases/${caseId}/turns`, { kind: 'text', text: 'i cant breathe' });

    const body = (await res.json()) as {
      riskTier: string;
      scoringSource: string;
      escalation: { escalated: boolean; detail?: string };
      degraded: boolean;
      degradationNotice?: string;
    };
    expect(body.riskTier).toBe('red');
    expect(body.scoringSource).toBe('local_rules');
    // The banner must be dark on a healthy case, or it means nothing when lit.
    expect(body.degraded).toBe(false);
    expect(body.degradationNotice).toBeUndefined();

    // And the tier traces to a rule that can be named, not to a symptom count.
    const state = await store.get(asCaseId(caseId));
    expect(state?.risk.triageTuples.length).toBeGreaterThan(0);
    expect(state?.risk.rootCause).toContain('red_flag');
  });

  it('404s an unknown case', async () => {
    const res = await fetch(`${baseUrl}/cases/case_nope`);
    expect(res.status).toBe(404);
  });

  it('cancels an active alert', async () => {
    const caseId = await newCase();
    await post(`/cases/${caseId}/turns`, { kind: 'text', text: 'I have chest pain' });
    const res = await post(`/cases/${caseId}/cancel`);
    expect(res.status).toBe(200);

    const after = await store.get(asCaseId(caseId));
    expect(after?.status).toBe('cancelled');
    expect(after?.dispatch.status).toBe('cancelled');
  });

  it('accepts quick-select tags and turns them into evidence', async () => {
    const caseId = await newCase();
    const res = await post(`/cases/${caseId}/turns`, {
      kind: 'quick_select',
      quickSelectTags: ['chest_pain', 'shortness_of_breath'],
    });
    expect(res.status).toBe(200);

    const state = await store.get(asCaseId(caseId));
    expect(state?.evidence.length).toBeGreaterThanOrEqual(2);
    expect(state?.evidence.every((e) => e.source === 'quick_select_tag')).toBe(true);
  });
});
