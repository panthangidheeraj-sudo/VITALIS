/**
 * Assembles the `AgentTools` the orchestrator runs against.
 *
 * This is the seam the whole port architecture was built for. The loop in
 * @triage/agent does not change at all as adapters are swapped here — today
 * most ports are the stand-ins from @triage/agent's testing module; as
 * credentials arrive they are replaced one at a time behind identical
 * interfaces.
 *
 * Those stand-ins are not "test doubles left in production by accident" — they
 * are the declared degraded mode. `LocalDeterministicScorer` in particular is
 * the real §6 fallback engine, and every result it returns carries a
 * `DegradationNotice` that surfaces to the patient. Nothing here can silently
 * pretend to be the live clinical engine.
 */

import type { AgentTools, CaseStorePort } from '@triage/shared';
import {
  InMemoryCaseStore,
  LocalDeterministicScorer,
  MockCodingPort,
  MockHospitalPort,
  MockKnowledgePort,
  MockMedicationPort,
  MockNormalizationPort,
  MockNotificationPort,
  MockReasoningPort,
} from '@triage/agent';
import type { ServerConfig } from '../config.js';
import { FirestoreCaseStore } from '../store/firestore-case-store.js';
import { DEMO_LEXICON } from './demo-lexicon.js';
import { SystemClock, UuidIdPort } from './system-ports.js';
import { getFirestore } from '../firebase.js';

export interface BuiltTools {
  readonly tools: AgentTools;
  /** True when writes land in real Firestore and the mobile app can observe them live. */
  readonly firestoreEnabled: boolean;
}

export function buildServerTools(config: ServerConfig): BuiltTools {
  const clock = new SystemClock();

  let store: CaseStorePort;
  let firestoreEnabled = false;
  if (config.firebase.enabled) {
    store = new FirestoreCaseStore(getFirestore(config));
    firestoreEnabled = true;
  } else {
    // The loop still runs end to end; it just is not observable from the
    // phone, because nothing is being written for a listener to pick up.
    store = new InMemoryCaseStore();
  }

  const tools: AgentTools = {
    clock,
    ids: new UuidIdPort(),

    // The only source of a clinical risk tier. Until Infermedica credentials
    // exist this is the conservative local fallback, and it says so on every
    // single result it returns.
    risk: new LocalDeterministicScorer(clock),

    // Stands in for Infermedica /parse and /search.
    normalize: new MockNormalizationPort(DEMO_LEXICON),

    // Stands in for Groq. Note it has no method that can return a risk tier —
    // that separation is enforced by the port interface itself, not by config.
    reasoning: new MockReasoningPort(clock),

    knowledge: new MockKnowledgePort(),
    medication: new MockMedicationPort(),
    coding: new MockCodingPort(),
    hospitals: new MockHospitalPort(),
    notifications: new MockNotificationPort(),
    store,
  };

  return { tools, firestoreEnabled };
}
