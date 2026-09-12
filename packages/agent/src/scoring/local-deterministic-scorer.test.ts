import { describe, expect, it } from 'vitest';
import { tierFor } from '@triage/shared';
import { ManualClock } from '../testing/manual-clock.js';
import {
  LocalDeterministicScorer,
  levelForPresentCount,
  presentSymptomCount,
} from './local-deterministic-scorer.js';

describe('presentSymptomCount', () => {
  it('counts only present, symptom-prefixed evidence', () => {
    const count = presentSymptomCount([
      { id: 's_1', choice_id: 'present' },
      { id: 's_2', choice_id: 'absent' },
      { id: 'p_1', choice_id: 'present' }, // risk factor, not a symptom
      { id: 's_3', choice_id: 'present' },
    ]);
    expect(count).toBe(2);
  });

  it('is zero for empty evidence', () => {
    expect(presentSymptomCount([])).toBe(0);
  });
});

describe('levelForPresentCount', () => {
  it('walks through all five triage levels as the count rises', () => {
    expect(levelForPresentCount(0)).toBe('self_care');
    expect(levelForPresentCount(1)).toBe('consultation');
    expect(levelForPresentCount(2)).toBe('consultation_24');
    expect(levelForPresentCount(3)).toBe('emergency');
    expect(levelForPresentCount(4)).toBe('emergency_ambulance');
  });

  it('clamps at the top level rather than throwing for very high counts', () => {
    expect(levelForPresentCount(50)).toBe('emergency_ambulance');
  });
});

describe('LocalDeterministicScorer', () => {
  it('always reports itself as a fallback source, never as live', async () => {
    const scorer = new LocalDeterministicScorer(new ManualClock());
    const result = await scorer.score({
      sex: 'male',
      ageYears: 52,
      evidence: [{ id: 's_21', choice_id: 'present' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.source === 'fallback') {
      expect(result.data.source).toBe('local_fallback');
      expect(result.data.degradedReason).toBeTruthy();
      expect(result.degraded.conservative).toBe(true);
    } else {
      expect.unreachable('LocalDeterministicScorer must always report source "fallback"');
    }
  });

  it('escalates the tier as more symptoms accumulate across calls', async () => {
    const scorer = new LocalDeterministicScorer(new ManualClock());
    const tiers: string[] = [];
    for (let n = 0; n <= 4; n++) {
      const evidence = Array.from({ length: n }, (_, i) => ({
        id: `s_${i}`,
        choice_id: 'present' as const,
      }));
      const result = await scorer.score({ sex: 'female', ageYears: 30, evidence });
      if (result.ok) tiers.push(result.data.tier);
    }
    expect(tiers).toEqual(['green', 'yellow', 'yellow', 'red', 'red']);
  });

  it('agrees with the shared policy on tier-for-level for everything it can return', async () => {
    const scorer = new LocalDeterministicScorer(new ManualClock());
    const result = await scorer.score({
      sex: 'male',
      ageYears: 40,
      evidence: [
        { id: 's_1', choice_id: 'present' },
        { id: 's_2', choice_id: 'present' },
        { id: 's_3', choice_id: 'present' },
      ],
    });
    if (result.ok) {
      expect(result.data.tier).toBe(tierFor(result.data.triageLevel));
    }
  });

  it('never lets a risk-factor-only evidence set look like an active symptom burden', async () => {
    const scorer = new LocalDeterministicScorer(new ManualClock());
    const result = await scorer.score({
      sex: 'male',
      ageYears: 60,
      evidence: [
        { id: 'p_1', choice_id: 'present' },
        { id: 'p_2', choice_id: 'present' },
        { id: 'p_3', choice_id: 'present' },
      ],
    });
    if (result.ok) expect(result.data.triageLevel).toBe('self_care');
  });
});
