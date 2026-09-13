/**
 * The design-to-live-state seam.
 *
 * `caseView.ts` is where the design's hand-written `STEPS` array was replaced by
 * derivation from real `CaseState`. That replacement is the single most
 * important thing about this port and it is also the easiest to undo by
 * accident — a future edit that reaches for a nice-looking constant instead of
 * a field would look completely fine on screen and would be showing a judge a
 * number the system never computed.
 *
 * These tests pin the properties that make the screens honest.
 */

import { describe, expect, it } from 'vitest';
import type { CaseState, ToolCallRecord } from '@triage/shared';
import { asCaseId, asUid } from '@triage/shared';
import { freshCaseState } from '@triage/agent';
import { buildCaseView, clockTime, outcomeSentence } from './caseView';

function caseWith(overrides: Partial<CaseState> = {}): CaseState {
  return { ...freshCaseState(), caseId: asCaseId('case_view'), ownerUid: asUid('uid_v'), ...overrides };
}

function toolCall(over: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'tc_1' as ToolCallRecord['id'],
    tool: 'osm.find_hospitals',
    role: 'logistics',
    status: 'succeeded',
    argsDigest: 'origin=20.29,85.82',
    turnId: 'turn_1' as ToolCallRecord['turnId'],
    phase: 'act',
    startedAt: '2026-09-13T07:04:00.000Z',
    completedAt: '2026-09-13T07:04:00.640Z',
    latencyMs: 640,
    ...over,
  } as ToolCallRecord;
}

describe('the tier header', () => {
  it('never claims a routing decision that has not been proposed', () => {
    const view = buildCaseView(caseWith(), [], []);
    // The design's header always shows an outcome because its script always
    // has one. A real case spends its first turns with no decision at all, and
    // printing "self-care guidance" there would be the agent recommending
    // something it has not decided.
    expect(view.outcomeLines).toContain('assessing');
    expect(view.outcomeLines).not.toContain('ambulance');
  });

  it('shows the proposed outcome once there is one', () => {
    const state = caseWith();
    const view = buildCaseView(
      {
        ...state,
        routing: {
          outcome: 'ambulance_dispatch',
          rationale: 'r',
          policyRule: 'baseOutcomeByTriageLevel',
          gate: { kind: 'press_and_hold_3s', state: 'pending', consequenceStatement: 'c', requiredHoldMs: 3000 },
          proposedAt: state.createdAt,
          basedOnRiskComputedAt: state.createdAt,
        },
      },
      [],
      [],
    );
    expect(view.outcomeLines).toContain('ambulance');
  });

  it('has wording for every one of the six outcomes', () => {
    // Including `escalate_human_unresolved`, which the design has no slot for
    // at all — a missing key here renders as literally nothing on screen.
    for (const outcome of [
      'self_care_guidance',
      'primary_care_24h',
      'urgent_care_now',
      'er_self_transport',
      'ambulance_dispatch',
      'escalate_human_unresolved',
    ] as const) {
      expect(outcomeSentence(outcome).length).toBeGreaterThan(0);
    }
  });
});

describe('the tool-call ledger', () => {
  /**
   * The sharpest correction in the whole port. The design's ledger rows read
   * `infermedica /parse` and `infermedica /triage`; this system has never
   * called Infermedica. A panel captioned LIVE naming a vendor that did not run
   * is a false provenance claim on the screen specifically meant to be
   * checkable.
   */
  it('prints the tool that actually ran, verbatim', () => {
    const view = buildCaseView(caseWith(), [], [toolCall()]);
    expect(view.ledger[0]?.call).toContain('osm.find_hospitals');
    expect(JSON.stringify(view.ledger)).not.toContain('infermedica');
  });

  it('shows a dash rather than "undefinedms" for a call that never returned', () => {
    const view = buildCaseView(
      caseWith(),
      [],
      [toolCall({ status: 'timed_out', latencyMs: undefined })],
    );
    expect(view.ledger[0]?.ms).toBe('—');
  });

  it('renders an empty ledger as empty, not as a placeholder row', () => {
    expect(buildCaseView(caseWith(), [], []).ledger).toHaveLength(0);
  });
});

describe('confidence', () => {
  it('leads with the unresolved contradiction when there is one', () => {
    const state = caseWith();
    const view = buildCaseView(
      {
        ...state,
        confidence: {
          ...state.confidence,
          alertActive: true,
          contradictions: [
            {
              kind: 'caregiver_vs_patient',
              detail: 'You said you are not sweating; the person with you says you are.',
              conflictingEvidenceIds: [],
              detectedAt: state.createdAt,
            },
          ],
        },
      },
      [],
      [],
    );
    // The patient is about to be told the agent will not act yet. Why cannot
    // be left implied.
    expect(view.confidenceSentence).toContain('not sweating');
    expect(view.confidenceLabel).toContain('ALERT');
  });

  /**
   * Zero bars is indistinguishable from a component that failed to render, and
   * on the confidence axis specifically that reads as "no confidence at all",
   * which is a much stronger claim than the score is making.
   */
  it('never renders zero bars for a live case', () => {
    const state = caseWith();
    const view = buildCaseView(
      { ...state, confidence: { ...state.confidence, score: 0 } },
      [],
      [],
    );
    expect(view.confidenceBars).toBeGreaterThanOrEqual(1);
  });
});

describe('clockTime', () => {
  it('formats as HH:MM', () => {
    expect(clockTime('2026-09-13T07:04:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('degrades to placeholders rather than printing "Invalid Date"', () => {
    expect(clockTime(undefined)).toBe('--:--');
    expect(clockTime('not a date')).toBe('--:--');
  });
});
