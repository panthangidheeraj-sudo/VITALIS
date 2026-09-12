import { describe, expect, it } from 'vitest';
import { asEvidenceId, type Contradiction, type EvidenceItem } from '@triage/shared';
import { hasUnresolved, mergeContradictions, resolveContradictions } from './resolve.js';

const T = '2026-09-12T07:03:15.000Z';
const LATER = '2026-09-12T07:03:45.000Z';

function evidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: asEvidenceId('ev_default'),
    conceptId: 's_47',
    conceptType: 'symptom',
    name: 'Excessive sweating',
    choiceId: 'present',
    source: 'caregiver_report',
    reliability: 'measured',
    observedAt: T,
    ...overrides,
  };
}

// The two items an actual contradiction would be built from: the patient's
// original denial, and the caregiver's conflicting observation.
const denied = evidenceItem({ id: asEvidenceId('ev_old'), choiceId: 'absent', source: 'question_answer', reliability: 'reported' });
const observed = evidenceItem({ id: asEvidenceId('ev_new'), choiceId: 'present', source: 'caregiver_report', reliability: 'measured' });

function contradiction(overrides: Partial<Contradiction> = {}): Contradiction {
  return {
    kind: 'self_report_vs_evidence',
    detail: 'flipped',
    conflictingEvidenceIds: [denied.id, observed.id],
    detectedAt: T,
    ...overrides,
  };
}

describe('resolveContradictions', () => {
  it('does NOT resolve using the very evidence that created the contradiction', () => {
    // Regression guard: this is the exact self-resolution bug the design
    // avoids. `observed` is one of the two conflicting items — passing it as
    // the only "new" evidence must leave the contradiction open.
    const c = contradiction();
    const result = resolveContradictions([c], [denied, observed], [observed], T);
    expect(result[0]!.resolvedAt).toBeUndefined();
  });

  it('resolves once an INDEPENDENT item confirms the same concept', () => {
    const c = contradiction();
    const independentConfirmation = evidenceItem({
      id: asEvidenceId('ev_confirm'),
      choiceId: 'present',
      source: 'question_answer',
      reliability: 'reported',
      observedAt: LATER,
    });
    const evidence = [denied, observed, independentConfirmation];
    const result = resolveContradictions([c], evidence, [independentConfirmation], LATER);

    expect(result[0]!.resolvedAt).toBe(LATER);
    expect(result[0]!.resolutionNote).toContain('independent confirmation');
    expect(result[0]!.resolutionNote).toContain('question_answer');
  });

  it('leaves a contradiction untouched when the new evidence is for an unrelated concept', () => {
    const c = contradiction();
    const unrelated = evidenceItem({ id: asEvidenceId('ev_unrelated'), conceptId: 's_21' });
    const result = resolveContradictions([c], [denied, observed, unrelated], [unrelated], LATER);
    expect(result[0]!.resolvedAt).toBeUndefined();
  });

  it('never re-resolves an already-resolved contradiction', () => {
    const c = contradiction({ resolvedAt: T, resolutionNote: 'first note' });
    const independentConfirmation = evidenceItem({ id: asEvidenceId('ev_confirm'), source: 'question_answer' });
    const result = resolveContradictions([c], [denied, observed, independentConfirmation], [independentConfirmation], LATER);
    expect(result[0]).toEqual(c);
  });

  it('is a no-op when nothing new was added', () => {
    const c = contradiction();
    expect(resolveContradictions([c], [denied, observed], [], LATER)).toEqual([c]);
  });
});

describe('mergeContradictions', () => {
  it('adds a newly detected contradiction', () => {
    const merged = mergeContradictions([], [contradiction()]);
    expect(merged).toHaveLength(1);
  });

  it('does not duplicate a contradiction with the same kind and evidence set', () => {
    const existing = contradiction();
    const duplicate = contradiction({ detail: 'reworded but same conflict' });
    const merged = mergeContradictions([existing], [duplicate]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.detail).toBe(existing.detail);
  });

  it('treats a different evidence pair as a distinct finding even with the same kind', () => {
    const existing = contradiction();
    const different = contradiction({
      conflictingEvidenceIds: [asEvidenceId('ev_other1'), asEvidenceId('ev_other2')],
    });
    expect(mergeContradictions([existing], [different])).toHaveLength(2);
  });
});

describe('hasUnresolved', () => {
  it('is true when any contradiction lacks a resolvedAt', () => {
    expect(hasUnresolved([contradiction()])).toBe(true);
  });

  it('is false once every contradiction is resolved', () => {
    expect(hasUnresolved([contradiction({ resolvedAt: T })])).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasUnresolved([])).toBe(false);
  });
});
