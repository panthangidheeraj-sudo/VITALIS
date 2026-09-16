/**
 * Family Relay Mode over HTTP (§5.5).
 *
 * The property these tests exist to protect is the two-step handoff. It would
 * be one endpoint shorter to mark the relay active the moment the message is
 * sent — and then a case whose caregiver never opened their phone would claim,
 * for as long as it lived, that a caregiver was answering. That is a false
 * statement on a clinical record, and it also hides the one signal that should
 * escalate the case to a human: nobody came.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentTools } from '@triage/shared';
import { asCaseId } from '@triage/shared';
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
} from '@triage/agent';
import { createApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { DEMO_LEXICON } from '../tools/demo-lexicon.js';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  nodeEnv: 'test',
  corsAllowedOrigins: undefined,
  firebase: { credentialsPath: undefined, projectId: undefined, enabled: false },
  groq: { apiKeys: [], baseUrl: 'http://127.0.0.1:9/v1', textModel: 'x', visionModel: 'y', enabled: false },
  infermedica: { appId: undefined, appKey: undefined, baseUrl: '', enabled: false },
  icd11: {
    clientId: undefined,
    clientSecret: undefined,
    tokenUrl: 'http://127.0.0.1:9/token',
    baseUrl: 'http://127.0.0.1:9',
    release: undefined,
    enabled: false,
  },
  knowledge: { medlinePlusSearchUrl: 'http://127.0.0.1:9/q', wikipediaBaseUrl: 'http://127.0.0.1:9' },
  rxnav: { baseUrl: 'http://127.0.0.1:9' },
  gemini: { apiKey: undefined, baseUrl: 'http://127.0.0.1:9', visionModel: 'x', enabled: false },
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

const MOTHER = {
  id: 'contact_mother',
  name: 'Sunita',
  relationship: 'parent',
  phoneE164: '+919876543210',
  whatsappEnabled: true,
  smsEnabled: false,
  priority: 0,
  canRelay: true,
};

const NEIGHBOUR = { ...MOTHER, id: 'contact_neighbour', name: 'Ravi', priority: 1, canRelay: false };

let server: Server;
let baseUrl: string;
let store: InMemoryCaseStore;

beforeAll(async () => {
  const clock = new ManualClock();
  store = new InMemoryCaseStore();
  const tools: AgentTools = {
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
  const res = await post('/cases', { ownerUid: 'uid_patient', ageYears: 68, sex: 'female' });
  return ((await res.json()) as { caseId: string }).caseId;
}

describe('requesting a relay', () => {
  it('invites only contacts marked as able to relay', async () => {
    const caseId = await newCase();
    const res = await post(`/cases/${caseId}/relay/request`, {
      patientName: 'Meera',
      contacts: [MOTHER, NEIGHBOUR],
      reason: 'patient_unresponsive',
      silenceSeconds: 95,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { invited: string[] };
    // Ravi is an emergency contact but was never authorised to answer clinical
    // questions on someone else's behalf. Those are different permissions.
    expect(body.invited).toEqual(['Sunita']);
  });

  it('does NOT mark the relay active merely because a message went out', async () => {
    const caseId = await newCase();
    await post(`/cases/${caseId}/relay/request`, { patientName: 'Meera', contacts: [MOTHER] });

    const state = await store.get(asCaseId(caseId));
    expect(state?.relay.requestedAt).toBeDefined();
    // The whole reason this is two endpoints. Nobody has read the message yet.
    expect(state?.relay.active).toBe(false);
    expect(state?.mode).toBe('patient');
  });

  it('says so plainly when nobody on the profile can take over', async () => {
    const caseId = await newCase();
    const res = await post(`/cases/${caseId}/relay/request`, {
      patientName: 'Meera',
      contacts: [NEIGHBOUR],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('no_relay_capable_contact');
  });

  it('rejects a phone number that is not E.164', async () => {
    const caseId = await newCase();
    const res = await post(`/cases/${caseId}/relay/request`, {
      patientName: 'Meera',
      contacts: [{ ...MOTHER, phoneE164: '9876543210' }],
    });
    // A local-format number is accepted by Twilio's API and then never
    // delivered — a failure that is invisible until the moment it matters.
    expect(res.status).toBe(400);
  });
});

describe('accepting a relay', () => {
  async function requested(): Promise<string> {
    const caseId = await newCase();
    await post(`/cases/${caseId}/relay/request`, { patientName: 'Meera', contacts: [MOTHER] });
    return caseId;
  }

  it('grants the caregiver read access and shifts the tone (§5.5)', async () => {
    const caseId = await requested();
    const res = await post(`/cases/${caseId}/relay/accept`, { relayUid: 'uid_caregiver' });
    expect(res.status).toBe(200);

    const state = await store.get(asCaseId(caseId));
    expect(state?.relay.active).toBe(true);
    expect(state?.mode).toBe('family_relay');
    // Without this uid in the array the caregiver's live listener returns
    // nothing at all, with no error — a blank screen, not a permission message.
    expect(state?.relayUids).toContain('uid_caregiver');
    // The adaptation itself: a caregiver can be asked clinically precise
    // questions that a frightened patient cannot.
    expect(state?.communication.state).toBe('caregiver_relay');
  });

  it('is idempotent — a second tap does not duplicate the uid', async () => {
    const caseId = await requested();
    await post(`/cases/${caseId}/relay/accept`, { relayUid: 'uid_caregiver' });
    await post(`/cases/${caseId}/relay/accept`, { relayUid: 'uid_caregiver' });

    const state = await store.get(asCaseId(caseId));
    // The array is read on every single document read; duplicates grow it for
    // the life of the case.
    expect(state?.relayUids?.filter((u) => u === 'uid_caregiver')).toHaveLength(1);
  });

  it('refuses to join a case that never asked for help', async () => {
    const caseId = await newCase();
    const res = await post(`/cases/${caseId}/relay/accept`, { relayUid: 'uid_stranger' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('relay_not_requested');
  });
});
