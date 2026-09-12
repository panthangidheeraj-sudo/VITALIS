/**
 * Policy invariants.
 *
 * These are the rules that must not quietly change. Several of them are safety
 * properties the spec calls non-negotiable, so they are tested exhaustively
 * over the enums rather than with a couple of hand-picked examples — an
 * example-based test passes right up until someone adds a sixth triage level.
 */

import { describe, expect, it } from 'vitest';
import { asEvidenceId } from '../types/common.js';
import { COMMUNICATION_STATES } from '../types/communication.js';
import { CONFIDENCE_LEVELS } from '../types/confidence.js';
import { RISK_TIERS, TRIAGE_LEVELS } from '../types/risk.js';
import { ROUTING_OUTCOMES } from '../types/routing.js';
import {
  BASE_OUTCOME_BY_LEVEL,
  GATE_BY_OUTCOME,
  MAX_INTERVIEW_TURNS,
  MIN_EVIDENCE_TO_SCORE,
  TRIAGE_LEVEL_TO_TIER,
  allowedRoutingOutcomes,
  canFinalizeRouting,
  mustEscalateUnresolved,
  readyToScore,
  recommendOutcome,
  requiredGate,
  tierFor,
  verifyDecision,
} from './risk-policy.js';

const noContradictions = {
  alertActive: false,
  contradictions: [] as const,
};

describe('triage level → risk tier', () => {
  it('maps all five Infermedica levels, not the three named in the spec', () => {
    expect(TRIAGE_LEVELS).toHaveLength(5);
    for (const level of TRIAGE_LEVELS) {
      expect(RISK_TIERS).toContain(TRIAGE_LEVEL_TO_TIER[level]);
    }
  });

  it('places both emergency levels in red and self_care in green', () => {
    expect(tierFor('emergency_ambulance')).toBe('red');
    expect(tierFor('emergency')).toBe('red');
    expect(tierFor('consultation_24')).toBe('yellow');
    expect(tierFor('consultation')).toBe('yellow');
    expect(tierFor('self_care')).toBe('green');
  });
});

describe('allowed routing outcomes', () => {
  it('never permits self-care on a red tier, at any confidence', () => {
    for (const confidence of CONFIDENCE_LEVELS) {
      expect(allowedRoutingOutcomes('red', confidence)).not.toContain('self_care_guidance');
    }
  });

  it('permits only escalation when risk is red and confidence is low', () => {
    expect(allowedRoutingOutcomes('red', 'low')).toEqual(['escalate_human_unresolved']);
  });

  it('removes the gentlest option from yellow when confidence is low', () => {
    expect(allowedRoutingOutcomes('yellow', 'high')).toContain('primary_care_24h');
    expect(allowedRoutingOutcomes('yellow', 'low')).not.toContain('primary_care_24h');
  });

  it('always leaves escalation available — refusing to guess is never wrong', () => {
    for (const tier of RISK_TIERS) {
      for (const confidence of CONFIDENCE_LEVELS) {
        expect(allowedRoutingOutcomes(tier, confidence)).toContain('escalate_human_unresolved');
      }
    }
  });

  it('never returns an empty set', () => {
    for (const tier of RISK_TIERS) {
      for (const confidence of CONFIDENCE_LEVELS) {
        expect(allowedRoutingOutcomes(tier, confidence).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('safety gates (§5.2, non-negotiable)', () => {
  it('always requires a 3-second press-and-hold for ambulance dispatch', () => {
    const gate = requiredGate('ambulance_dispatch');
    expect(gate.kind).toBe('press_and_hold_3s');
    expect(gate.requiredHoldMs).toBe(3000);
    expect(gate.state).toBe('pending');
  });

  it('gives every consequential outcome a gate and a stated consequence', () => {
    for (const outcome of ROUTING_OUTCOMES) {
      const gate = requiredGate(outcome);
      expect(gate.consequenceStatement.length).toBeGreaterThan(0);
      if (GATE_BY_OUTCOME[outcome] === 'none') {
        expect(gate.state).toBe('not_required');
      } else {
        expect(gate.state).toBe('pending');
      }
    }
  });

  /**
   * §8's load-bearing rule: "tone adapts, but clinical rigor and safety gates
   * never soften based on tone". `requiredGate` takes only an outcome, so this
   * is true by construction — the test pins the construction itself, so that
   * adding a tone parameter later fails here rather than silently shipping.
   */
  it('produces gates that cannot vary with communication state', () => {
    expect(requiredGate.length).toBe(1);

    for (const outcome of ROUTING_OUTCOMES) {
      const baseline = JSON.stringify(requiredGate(outcome));
      for (const _state of COMMUNICATION_STATES) {
        expect(JSON.stringify(requiredGate(outcome))).toBe(baseline);
      }
    }
  });

  it('exposes no policy function that accepts a communication state', () => {
    // Guards against a future "just for the panicked case" parameter.
    const policyFns = [
      allowedRoutingOutcomes,
      requiredGate,
      recommendOutcome,
      verifyDecision,
      canFinalizeRouting,
      mustEscalateUnresolved,
      tierFor,
      readyToScore,
    ];
    for (const fn of policyFns) {
      expect(fn.toString()).not.toMatch(/communication/i);
    }
  });
});

describe('routing is blocked until uncertainty is resolved (§5.1)', () => {
  it('blocks while a confidence alert is active', () => {
    const check = canFinalizeRouting({
      confidence: { alertActive: true, contradictions: [] },
      activeEvidenceCount: 6,
    });
    expect(check.blocked).toBe(true);
    if (check.blocked) {
      expect(check.reason).toBe('confidence_alert_active');
      expect(check.requiredAction).toBe('probe_contradiction');
    }
  });

  it('blocks on an unresolved contradiction even without an active alert', () => {
    const check = canFinalizeRouting({
      confidence: {
        alertActive: false,
        contradictions: [
          {
            kind: 'self_report_vs_evidence',
            detail: 'Says fine; reported a fall.',
            conflictingEvidenceIds: [asEvidenceId('ev_1'), asEvidenceId('ev_2')],
            detectedAt: '2026-09-12T07:03:15.000Z',
          },
        ],
      },
      activeEvidenceCount: 6,
    });
    expect(check.blocked).toBe(true);
    if (check.blocked) expect(check.reason).toBe('unresolved_contradiction');
  });

  it('blocks below the evidence floor', () => {
    const check = canFinalizeRouting({
      confidence: noContradictions,
      activeEvidenceCount: MIN_EVIDENCE_TO_SCORE - 1,
    });
    expect(check.blocked).toBe(true);
    if (check.blocked) expect(check.requiredAction).toBe('ask_question');
  });

  it('allows finalisation once resolved and sufficiently evidenced', () => {
    expect(
      canFinalizeRouting({ confidence: noContradictions, activeEvidenceCount: 5 }).blocked,
    ).toBe(false);
  });

  it('treats a resolved contradiction as no longer blocking', () => {
    const check = canFinalizeRouting({
      confidence: {
        alertActive: false,
        contradictions: [
          {
            kind: 'cross_turn_reversal',
            detail: 'Dyspnea absent then present.',
            conflictingEvidenceIds: [asEvidenceId('ev_006'), asEvidenceId('ev_005')],
            detectedAt: '2026-09-12T07:04:05.000Z',
            resolvedAt: '2026-09-12T07:04:40.000Z',
          },
        ],
      },
      activeEvidenceCount: 5,
    });
    expect(check.blocked).toBe(false);
  });
});

describe('escalation rather than invented certainty', () => {
  const base = {
    tier: 'red' as const,
    confidenceLevel: 'high' as const,
    unresolvedContradictionCount: 0,
    turnCount: 3,
    patientResponsive: true,
    clinicalScoringDegraded: false,
  };

  it('escalates a high-risk case built on unreliable information', () => {
    expect(mustEscalateUnresolved({ ...base, confidenceLevel: 'low' }).escalate).toBe(true);
  });

  it('escalates when the patient stops responding at elevated risk', () => {
    expect(mustEscalateUnresolved({ ...base, patientResponsive: false }).escalate).toBe(true);
  });

  it('escalates a red case scored by the degraded fallback engine', () => {
    expect(mustEscalateUnresolved({ ...base, clinicalScoringDegraded: true }).escalate).toBe(
      true,
    );
  });

  it('escalates when contradictions survive the interview limit', () => {
    expect(
      mustEscalateUnresolved({
        ...base,
        tier: 'yellow',
        unresolvedContradictionCount: 1,
        turnCount: MAX_INTERVIEW_TURNS,
      }).escalate,
    ).toBe(true);
  });

  it('does not escalate a clean, well-evidenced case', () => {
    expect(mustEscalateUnresolved(base).escalate).toBe(false);
  });

  it('always supplies a reason when it escalates', () => {
    const result = mustEscalateUnresolved({ ...base, confidenceLevel: 'low' });
    expect(result.reason).toBeTruthy();
  });
});

describe('recommendOutcome', () => {
  it('follows the clinical engine on a clean high-confidence case', () => {
    for (const level of TRIAGE_LEVELS) {
      const result = recommendOutcome({
        assessment: { tier: tierFor(level), triageLevel: level, source: 'infermedica' },
        confidenceLevel: 'high',
        escalation: { escalate: false },
      });
      expect(result.outcome).toBe(BASE_OUTCOME_BY_LEVEL[level]);
    }
  });

  it('steps up one level when the score came from the degraded fallback', () => {
    const result = recommendOutcome({
      assessment: { tier: 'green', triageLevel: 'self_care', source: 'local_fallback' },
      confidenceLevel: 'high',
      escalation: { escalate: false },
    });
    expect(result.outcome).toBe('primary_care_24h');
    expect(result.policyRule).toBe('conservativeStepUp:degradedScoring');
  });

  it('never steps a degraded score straight into escalation on its own', () => {
    const result = recommendOutcome({
      assessment: {
        tier: 'red',
        triageLevel: 'emergency_ambulance',
        source: 'local_fallback',
      },
      confidenceLevel: 'high',
      escalation: { escalate: false },
    });
    expect(result.outcome).not.toBe('escalate_human_unresolved');
  });

  it('honours a forced escalation above everything else', () => {
    const result = recommendOutcome({
      assessment: { tier: 'green', triageLevel: 'self_care', source: 'infermedica' },
      confidenceLevel: 'low',
      escalation: { escalate: true, reason: 'patient unresponsive' },
    });
    expect(result.outcome).toBe('escalate_human_unresolved');
  });

  it('only ever recommends something the allow-list permits', () => {
    for (const level of TRIAGE_LEVELS) {
      for (const confidence of CONFIDENCE_LEVELS) {
        for (const source of ['infermedica', 'local_fallback'] as const) {
          const tier = tierFor(level);
          const result = recommendOutcome({
            assessment: { tier, triageLevel: level, source },
            confidenceLevel: confidence,
            escalation: { escalate: false },
          });
          expect(allowedRoutingOutcomes(tier, confidence)).toContain(result.outcome);
        }
      }
    }
  });
});

describe('verifyDecision — the gate before anything is shown', () => {
  it('accepts a correctly-formed red/ambulance decision', () => {
    expect(
      verifyDecision({
        outcome: 'ambulance_dispatch',
        gate: requiredGate('ambulance_dispatch'),
        tier: 'red',
        confidenceLevel: 'high',
        unresolvedContradictionCount: 0,
      }),
    ).toEqual({ valid: true });
  });

  it('rejects self-care on a red tier', () => {
    const result = verifyDecision({
      outcome: 'self_care_guidance',
      gate: requiredGate('self_care_guidance'),
      tier: 'red',
      confidenceLevel: 'high',
      unresolvedContradictionCount: 0,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.violations.join(' ')).toContain('never route to self-care');
    }
  });

  it('rejects an ambulance dispatch carrying the wrong gate', () => {
    const result = verifyDecision({
      outcome: 'ambulance_dispatch',
      gate: requiredGate('urgent_care_now'),
      tier: 'red',
      confidenceLevel: 'high',
      unresolvedContradictionCount: 0,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects any non-escalation outcome while contradictions stand', () => {
    for (const outcome of ROUTING_OUTCOMES) {
      const result = verifyDecision({
        outcome,
        gate: requiredGate(outcome),
        tier: 'yellow',
        confidenceLevel: 'high',
        unresolvedContradictionCount: 1,
      });
      if (outcome === 'escalate_human_unresolved') continue;
      expect(result.valid).toBe(false);
    }
  });

  it('accepts every recommendation the policy itself produces', () => {
    // Round-trip property: the recommender must never emit something the
    // verifier rejects, or the agent deadlocks at the last gate.
    for (const level of TRIAGE_LEVELS) {
      for (const confidence of CONFIDENCE_LEVELS) {
        const tier = tierFor(level);
        const { outcome } = recommendOutcome({
          assessment: { tier, triageLevel: level, source: 'infermedica' },
          confidenceLevel: confidence,
          escalation: { escalate: false },
        });
        expect(
          verifyDecision({
            outcome,
            gate: requiredGate(outcome),
            tier,
            confidenceLevel: confidence,
            unresolvedContradictionCount: 0,
          }),
        ).toEqual({ valid: true });
      }
    }
  });
});

describe('evidence floor', () => {
  it('requires at least two active evidence items before scoring', () => {
    expect(readyToScore(0)).toBe(false);
    expect(readyToScore(MIN_EVIDENCE_TO_SCORE - 1)).toBe(false);
    expect(readyToScore(MIN_EVIDENCE_TO_SCORE)).toBe(true);
  });
});
