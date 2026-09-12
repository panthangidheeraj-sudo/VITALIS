import { describe, expect, it } from 'vitest';
import { activeEvidence } from '@triage/shared';
import { SequentialIdPort } from '../testing/sequential-id-port.js';
import { applyEvidence } from './apply-evidence.js';

const ids = () => new SequentialIdPort();
const T = '2026-09-12T07:00:00.000Z';

describe('applyEvidence', () => {
  it('adds a brand-new concept with no supersession', () => {
    const { evidence, added } = applyEvidence(
      [],
      [
        {
          conceptId: 's_21',
          conceptType: 'symptom',
          name: 'Chest pain',
          choiceId: 'present',
          source: 'initial_complaint',
          reliability: 'reported',
        },
      ],
      T,
      ids(),
    );
    expect(evidence).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(evidence[0]!.supersedes).toBeUndefined();
  });

  it('drops a true repeat: same concept, same answer, same source, same reliability', () => {
    const idPort = ids();
    const first = applyEvidence(
      [],
      [
        {
          conceptId: 's_21',
          conceptType: 'symptom',
          name: 'Chest pain',
          choiceId: 'present',
          source: 'question_answer',
          reliability: 'reported',
        },
      ],
      T,
      idPort,
    );
    const second = applyEvidence(
      first.evidence,
      [
        {
          conceptId: 's_21',
          conceptType: 'symptom',
          name: 'Chest pain',
          choiceId: 'present',
          source: 'question_answer',
          reliability: 'reported',
        },
      ],
      T,
      idPort,
    );
    expect(second.added).toHaveLength(0);
    expect(second.evidence).toHaveLength(1);
  });

  it('still records an item when the same answer comes from a different, independent source', () => {
    // This is deliberate, not a duplicate: independent corroboration of an
    // unchanged answer is exactly what resolves an open contradiction later
    // (see contradiction/resolve.ts) and would be lost if silently dropped.
    const idPort = ids();
    const first = applyEvidence(
      [],
      [
        {
          conceptId: 's_21',
          conceptType: 'symptom',
          name: 'Chest pain',
          choiceId: 'present',
          source: 'initial_complaint',
          reliability: 'reported',
        },
      ],
      T,
      idPort,
    );
    const second = applyEvidence(
      first.evidence,
      [
        {
          conceptId: 's_21',
          conceptType: 'symptom',
          name: 'Chest pain',
          choiceId: 'present',
          source: 'caregiver_report',
          reliability: 'measured',
        },
      ],
      T,
      idPort,
    );
    expect(second.added).toHaveLength(1);
    expect(second.evidence).toHaveLength(2);
    // Neither is superseded — both agree, so both stay active.
    expect(second.evidence.every((e) => e.supersededBy === undefined)).toBe(true);
  });

  it('supersedes when the same concept gets a different answer', () => {
    const idPort = ids();
    const first = applyEvidence(
      [],
      [
        {
          conceptId: 's_47',
          conceptType: 'symptom',
          name: 'Excessive sweating',
          choiceId: 'absent',
          source: 'question_answer',
          reliability: 'reported',
          rawText: 'no, not sweating',
        },
      ],
      T,
      idPort,
    );
    const second = applyEvidence(
      first.evidence,
      [
        {
          conceptId: 's_47',
          conceptType: 'symptom',
          name: 'Excessive sweating',
          choiceId: 'present',
          source: 'caregiver_report',
          reliability: 'measured',
          rawText: 'he is drenched in sweat',
        },
      ],
      '2026-09-12T07:03:10.000Z',
      idPort,
    );

    expect(second.added).toHaveLength(1);
    const [newItem] = second.added;
    const oldItem = second.evidence.find((e) => e.id === newItem!.supersedes);

    expect(newItem!.supersedes).toBe(first.added[0]!.id);
    expect(oldItem?.supersededBy).toBe(newItem!.id);
    expect(oldItem?.choiceId).toBe('absent');
    expect(newItem!.choiceId).toBe('present');

    // The stale answer is retained but no longer active.
    expect(second.evidence).toHaveLength(2);
    expect(activeEvidence(second.evidence)).toHaveLength(1);
    expect(activeEvidence(second.evidence)[0]!.choiceId).toBe('present');
  });

  it('only supersedes the most recent active item, not every historical one', () => {
    const idPort = ids();
    let evidence = applyEvidence(
      [],
      [
        {
          conceptId: 's_13',
          conceptType: 'symptom',
          name: 'Dyspnea',
          choiceId: 'absent',
          source: 'question_answer',
          reliability: 'reported',
        },
      ],
      T,
      idPort,
    ).evidence;
    evidence = applyEvidence(
      evidence,
      [
        {
          conceptId: 's_13',
          conceptType: 'symptom',
          name: 'Dyspnea',
          choiceId: 'present',
          source: 'question_answer',
          reliability: 'reported',
        },
      ],
      '2026-09-12T07:04:00.000Z',
      idPort,
    ).evidence;
    const third = applyEvidence(
      evidence,
      [
        {
          conceptId: 's_13',
          conceptType: 'symptom',
          name: 'Dyspnea',
          choiceId: 'absent',
          source: 'question_answer',
          reliability: 'reported',
        },
      ],
      '2026-09-12T07:06:00.000Z',
      idPort,
    );

    // Every earlier item ends up superseded — transitively, each by the one
    // that followed it — but only the LAST one is active. A chain, not a
    // single item magically exempted from ever being replaced.
    expect(activeEvidence(third.evidence)).toHaveLength(1);
    const [original, middle, latest] = third.evidence;
    expect(original!.supersededBy).toBe(middle!.id);
    expect(middle!.supersededBy).toBe(latest!.id);
    expect(latest!.supersededBy).toBeUndefined();
    expect(activeEvidence(third.evidence)[0]!.id).toBe(latest!.id);
  });

  it('adds evidence unaffected by an unrelated concept in the same batch', () => {
    const { evidence, added } = applyEvidence(
      [],
      [
        {
          conceptId: 's_21',
          conceptType: 'symptom',
          name: 'Chest pain',
          choiceId: 'present',
          source: 'initial_complaint',
          reliability: 'reported',
        },
        {
          conceptId: 'p_8',
          conceptType: 'risk_factor',
          name: 'Smoking',
          choiceId: 'present',
          source: 'patient_record',
          reliability: 'reported',
        },
      ],
      T,
      ids(),
    );
    expect(added).toHaveLength(2);
    expect(evidence).toHaveLength(2);
  });
});
