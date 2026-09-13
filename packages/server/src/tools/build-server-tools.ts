/**
 * Assembles the `AgentTools` the orchestrator runs against.
 *
 * This is the seam the whole port architecture was built for. The loop in
 * @triage/agent does not change at all as adapters are swapped here — today
 * most ports are the stand-ins from @triage/agent's testing module; as
 * credentials arrive they are replaced one at a time behind identical
 * interfaces.
 *
 * Those stand-ins are not "test doubles left in production by accident" - they
 * are the declared degraded mode, and each says so on every result it returns.
 * `LocalDeterministicScorer` is the exception: it is the PRIMARY clinical
 * engine now that Infermedica has been dropped, and it reports itself as live
 * because it is. Nothing here can silently pretend to be something it is not.
 */

import type { AgentTools, CaseStorePort } from '@triage/shared';
import {
  InMemoryCaseStore,
  LocalDeterministicScorer,
  MockCodingPort,
  MockNormalizationPort,
  MockNotificationPort,
  MockReasoningPort,
} from '@triage/agent';
import type { ServerConfig } from '../config.js';
import { GeminiVisionPort } from '../adapters/gemini-vision-port.js';
import { GroqReasoningPort } from '../adapters/groq-reasoning-port.js';
import { HealthKnowledgePort } from '../adapters/knowledge-port.js';
import { Icd11CodingPort } from '../adapters/icd11-coding-port.js';
import { OsmHospitalPort } from '../adapters/osm-hospital-port.js';
import { RxNavMedicationPort } from '../adapters/rxnav-medication-port.js';
import { TwilioNotificationPort } from '../adapters/twilio-notification-port.js';
import { FirestoreCaseStore } from '../store/firestore-case-store.js';
import { DEMO_LEXICON } from './demo-lexicon.js';
import { SystemClock, UuidIdPort } from './system-ports.js';
import { getFirestore } from '../firebase.js';

export interface BuiltTools {
  readonly tools: AgentTools;
  /** True when writes land in real Firestore and the mobile app can observe them live. */
  readonly firestoreEnabled: boolean;
}

/**
 * Layers the reasoning adapters: Groq for text, Gemini wrapped around it for
 * vision, the deterministic stand-in underneath both. Each layer overrides only
 * what it can actually do, so a missing key removes one capability rather than
 * the whole port.
 */
function buildReasoning(config: ServerConfig, clock: SystemClock) {
  const base = config.groq.enabled
    ? new GroqReasoningPort(
        {
          apiKey: config.groq.apiKey as string,
          baseUrl: config.groq.baseUrl,
          textModel: config.groq.textModel,
          visionModel: config.groq.visionModel,
        },
        new MockReasoningPort(clock),
      )
    : new MockReasoningPort(clock);

  return config.gemini.enabled
    ? new GeminiVisionPort(
        {
          apiKey: config.gemini.apiKey as string,
          baseUrl: config.gemini.baseUrl,
          visionModel: config.gemini.visionModel,
        },
        base,
      )
    : base;
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

    // The only source of a clinical risk tier, and a deterministic rule table
    // rather than a model. See packages/agent/src/scoring/rules.ts.
    risk: new LocalDeterministicScorer(clock),

    // Stands in for Infermedica /parse and /search.
    normalize: new MockNormalizationPort(DEMO_LEXICON),

    // Groq for text, Gemini for vision, deterministic stand-in underneath.
    // None of the three has a method that can return a risk tier - that is
    // enforced by the port interface, not by config, so it holds identically
    // whichever of them is reachable.
    reasoning: buildReasoning(config, clock),

    // --- Real adapters, all free tier -------------------------------------
    // None of these can influence the risk tier: KnowledgePort explains,
    // MedicationPort normalises names, CodingPort labels an already-derived
    // category. The port interfaces have no method that returns a severity.
    knowledge: new HealthKnowledgePort(config.knowledge),
    medication: new RxNavMedicationPort(config.rxnav.baseUrl),
    coding: config.icd11.enabled
      ? new Icd11CodingPort({
          clientId: config.icd11.clientId as string,
          clientSecret: config.icd11.clientSecret as string,
          tokenUrl: config.icd11.tokenUrl,
          baseUrl: config.icd11.baseUrl,
          release: config.icd11.release,
        })
      : new MockCodingPort(),
    // Real coordinates from OpenStreetMap. The specialty and bed-count overlay
    // is still simulated - no public API publishes live bed counts - and every
    // record carries `dataProvenance` saying which half is which.
    hospitals: new OsmHospitalPort({
      overpassUrl: config.osm.overpassUrl,
      ...(config.osm.contactEmail !== undefined ? { contactEmail: config.osm.contactEmail } : {}),
    }),

    // The only port that reaches a real person. `live` is deliberately a
    // separate decision from `enabled`; see the adapter header.
    notifications: config.twilio.enabled
      ? new TwilioNotificationPort({
          accountSid: config.twilio.accountSid as string,
          authToken: config.twilio.authToken as string,
          ...(config.twilio.whatsappFrom !== undefined
            ? { whatsappFrom: config.twilio.whatsappFrom }
            : {}),
          ...(config.twilio.smsFrom !== undefined ? { smsFrom: config.twilio.smsFrom } : {}),
          live: config.twilio.live,
        })
      : new MockNotificationPort(),
    store,
  };

  return { tools, firestoreEnabled };
}
