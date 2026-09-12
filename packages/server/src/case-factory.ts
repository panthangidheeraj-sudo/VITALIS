/**
 * Builds the initial `CaseState` for a new emergency.
 *
 * The problem statement requires the agent to "begin with incomplete patient
 * information" — so this deliberately creates an EMPTY case: no evidence, a
 * green tier that has not actually been scored yet, and neutral communication
 * state. Everything is discovered through the interview. Seeding it with
 * assumed symptoms would quietly skip the part being judged.
 */

import type { AgentTools, BiologicalSex, CaseState, Language } from '@triage/shared';
import { asCaseId, asUid, COMPANION_DEFAULT_INTERVAL_MS } from '@triage/shared';

export interface CreateCaseInput {
  /**
   * Firebase Auth uid of the device opening the case. Without it the case is
   * written but unreadable by any client, so the route rejects a request that
   * omits it rather than creating one that silently never appears on screen.
   */
  readonly ownerUid: string;
  readonly ageYears: number;
  readonly sex: BiologicalSex;
  readonly language?: Language;
  readonly displayName?: string;
  readonly isMinor?: boolean;
}

export function buildNewCase(input: CreateCaseInput, tools: AgentTools): CaseState {
  const now = tools.clock.now();
  const language: Language = input.language ?? 'en';

  return {
    caseId: asCaseId(tools.ids.newId('case')),
    schemaVersion: 1,
    revision: 0,
    ownerUid: asUid(input.ownerUid),
    status: 'interviewing',
    mode: 'patient',
    language,
    demographics: {
      ageYears: input.ageYears,
      sex: input.sex,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      preferredLanguage: language,
      isMinor: input.isMinor ?? input.ageYears < 18,
    },
    vitals: [],
    evidence: [],
    risk: {
      tier: 'green',
      triageLevel: 'self_care',
      seriousFlags: [],
      triageTuples: [],
      source: 'local_rules',
      // Honest from the first instant: nothing has been assessed yet, and the
      // green tier below is a default, not a finding.
      degradedReason: 'No clinical assessment has been run yet — this is a starting default, not a result.',
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
      intervalMs: COMPANION_DEFAULT_INTERVAL_MS,
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
