/**
 * Assembles a complete, deterministic `AgentTools` for tests, and a fresh
 * `CaseState` to run the loop against. One call gets a test everything it
 * needs; individual pieces (clock, store, lexicon) stay reachable on the
 * returned object for assertions and mid-test manipulation.
 */

import type { AgentTools, BiologicalSex, CaseState, Language } from '@triage/shared';
import { asCaseId } from '@triage/shared';
import { LocalDeterministicScorer } from '../scoring/local-deterministic-scorer.js';
import { InMemoryCaseStore } from './in-memory-store.js';
import { ManualClock } from './manual-clock.js';
import { type LexiconEntry, MockNormalizationPort } from './mock-normalization-port.js';
import { MockReasoningPort } from './mock-reasoning-port.js';
import {
  MockCodingPort,
  MockHospitalPort,
  MockKnowledgePort,
  MockMedicationPort,
  MockNotificationPort,
} from './mock-support-ports.js';
import { SequentialIdPort } from './sequential-id-port.js';

export interface TestHarness {
  readonly tools: AgentTools;
  readonly clock: ManualClock;
  readonly store: InMemoryCaseStore;
}

export function buildTestTools(lexicon: readonly LexiconEntry[]): TestHarness {
  const clock = new ManualClock();
  const store = new InMemoryCaseStore();

  const tools: AgentTools = {
    clock,
    ids: new SequentialIdPort(),
    risk: new LocalDeterministicScorer(clock),
    normalize: new MockNormalizationPort(lexicon),
    reasoning: new MockReasoningPort(clock),
    knowledge: new MockKnowledgePort(),
    medication: new MockMedicationPort(),
    coding: new MockCodingPort(),
    hospitals: new MockHospitalPort(),
    notifications: new MockNotificationPort(),
    store,
  };

  return { tools, clock, store };
}

export function freshCaseState(
  overrides: Partial<{ ageYears: number; sex: BiologicalSex; language: Language }> = {},
): CaseState {
  const now = '2026-09-12T07:00:00.000Z';
  return {
    caseId: asCaseId('case_test_1'),
    schemaVersion: 1,
    revision: 0,
    status: 'interviewing',
    mode: 'patient',
    language: overrides.language ?? 'en',
    demographics: {
      ageYears: overrides.ageYears ?? 52,
      sex: overrides.sex ?? 'male',
      preferredLanguage: overrides.language ?? 'en',
      isMinor: false,
    },
    vitals: [],
    evidence: [],
    risk: {
      tier: 'green',
      triageLevel: 'self_care',
      seriousFlags: [],
      triageTuples: [],
      source: 'local_fallback',
      degradedReason: 'No assessment has been run yet.',
      evidenceCount: 0,
      computedAt: now,
    },
    confidence: {
      score: 0.6,
      level: 'medium',
      reasons: [],
      contradictions: [],
      alertActive: false,
      updatedAt: now,
    },
    communication: {
      state: 'neutral',
      certainty: 0,
      signals: [],
      since: now,
      updatedAt: now,
    },
    turnCount: 0,
    dispatch: { status: 'not_dispatched', simulated: true },
    relay: { active: false },
    companion: {
      active: false,
      intervalMs: 180000,
      reassessmentCount: 0,
      trends: {},
    },
    escalation: { escalated: false },
    degradation: { clinicalScoringDegraded: false, affectedTools: [] },
    notifications: [],
    createdAt: now,
    updatedAt: now,
  };
}
