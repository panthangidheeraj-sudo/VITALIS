import { describe, expect, it } from 'vitest';
import { asEvidenceId, type Contradiction, type EvidenceItem } from '@triage/shared';
import { computeConfidence } from './confidence-policy.js';

const T = '2026-09-12T07:05:00.000Z';

const neutralComm = {
  state: 'neutral' as const,
  certainty: 0.5,
  signals: [],
  since: T,
  updatedAt: T,
};

function evidenceItem(id: string): EvidenceItem {
  return {
    id: asEvidenceId(id),
    conceptId: 's_21',
    conceptType: 'symptom',
    name: 'Chest pain',
    choiceId: 'present',
    source: 'question_answer',
    reliability: 'reported',
    observedAt: T,
  };
}

describe('computeConfidence', () => {
  it('penalises sparse evidence below the scoring floor', () => {
    const result = computeConfidence(
      { evidence: [], contradictions: [], communication: neutralComm, minEvidenceToScore: 2 },
      T,
    );
    expect(result.reasons.some((r) => r.code === 'sparse_evidence')).toBe(true);
    expect(result.score).toBeLessThan(0.6);
  });

  it('rewards a rich, consistent evidence base', () => {
    const evidence = [evidenceItem('ev1'), evidenceItem('ev2'), evidenceItem('ev3'), evidenceItem('ev4')];
    const result = computeConfidence(
      { evidence, contradictions: [], communication: neutralComm, minEvidenceToScore: 2 },
      T,
    );
    expect(result.reasons.some((r) => r.code === 'consistent_across_turns')).toBe(true);
    expect(result.score).toBeGreaterThan(0.6);
  });

  it('activates the alert and drags the score down on an unresolved contradiction', () => {
    const unresolved: Contradiction = {
      kind: 'self_report_vs_evidence',
      detail: 'conflict',
      conflictingEvidenceIds: [asEvidenceId('ev1'), asEvidenceId('ev2')],
      detectedAt: T,
    };
    const result = computeConfidence(
      {
        evidence: [evidenceItem('ev1'), evidenceItem('ev2')],
        contradictions: [unresolved],
        communication: neutralComm,
        minEvidenceToScore: 2,
      },
      T,
    );
    expect(result.alertActive).toBe(true);
    expect(result.level).not.toBe('high');
  });

  it('deactivates the alert once every contradiction is resolved', () => {
    const resolved: Contradiction = {
      kind: 'self_report_vs_evidence',
      detail: 'conflict',
      conflictingEvidenceIds: [asEvidenceId('ev1'), asEvidenceId('ev2')],
      detectedAt: T,
      resolvedAt: T,
      resolutionNote: 'Resolved by caregiver_report (measured): "confirmed".',
    };
    const result = computeConfidence(
      {
        evidence: [evidenceItem('ev1'), evidenceItem('ev2')],
        contradictions: [resolved],
        communication: neutralComm,
        minEvidenceToScore: 2,
      },
      T,
    );
    expect(result.alertActive).toBe(false);
    expect(result.reasons.some((r) => r.code === 'corroborated_by_measurement')).toBe(true);
  });

  it('lowers confidence for terse answers and raises it for articulate ones', () => {
    const evidence = [evidenceItem('ev1'), evidenceItem('ev2')];
    const terse = computeConfidence(
      {
        evidence,
        contradictions: [],
        communication: { ...neutralComm, state: 'terse' },
        minEvidenceToScore: 2,
      },
      T,
    );
    const articulate = computeConfidence(
      {
        evidence,
        contradictions: [],
        communication: { ...neutralComm, state: 'articulate' },
        minEvidenceToScore: 2,
      },
      T,
    );
    expect(terse.score).toBeLessThan(articulate.score);
  });

  it('always keeps the score within 0..1', () => {
    const manyUnresolved: Contradiction[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'self_report_vs_evidence',
      detail: 'x',
      conflictingEvidenceIds: [asEvidenceId(`a${i}`), asEvidenceId(`b${i}`)],
      detectedAt: T,
    }));
    const result = computeConfidence(
      { evidence: [], contradictions: manyUnresolved, communication: neutralComm, minEvidenceToScore: 2 },
      T,
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('carries forward the original alertRaisedAt while the alert stays active', () => {
    const unresolved: Contradiction = {
      kind: 'cross_turn_reversal',
      detail: 'x',
      conflictingEvidenceIds: [asEvidenceId('ev1'), asEvidenceId('ev2')],
      detectedAt: '2026-09-12T07:03:00.000Z',
    };
    const previous = computeConfidence(
      {
        evidence: [evidenceItem('ev1'), evidenceItem('ev2')],
        contradictions: [unresolved],
        communication: neutralComm,
        minEvidenceToScore: 2,
      },
      '2026-09-12T07:03:00.000Z',
    );
    const next = computeConfidence(
      {
        evidence: [evidenceItem('ev1'), evidenceItem('ev2'), evidenceItem('ev3')],
        contradictions: [unresolved],
        communication: neutralComm,
        minEvidenceToScore: 2,
        previous,
      },
      '2026-09-12T07:04:00.000Z',
    );
    expect(next.alertRaisedAt).toBe(previous.alertRaisedAt);
  });
});
