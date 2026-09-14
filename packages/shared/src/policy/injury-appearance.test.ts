import { describe, expect, it } from 'vitest';
import type { InjuryObservation } from '../types/injury.js';
import { compareObservations, severityFromSigns, severityLabel } from './injury-appearance.js';

const observation = (partial: Partial<InjuryObservation>): InjuryObservation => ({
  id: 'inj_1',
  at: '2026-01-01T00:00:00.000Z' as InjuryObservation['at'],
  visibleSigns: [],
  description: 'x',
  severity: 'mild',
  imageQuality: 0.9,
  trend: 'unknown',
  ...partial,
});

describe('severityFromSigns', () => {
  it('refuses to grade a photo that is too poor to read', () => {
    // The whole point: an unreadable photo is NOT "mild".
    expect(severityFromSigns(['heavy_bleeding'], 0.1)).toBe('unable_to_assess');
    expect(severityFromSigns([], 0.9)).toBe('unable_to_assess');
  });

  it('treats a readable photo showing nothing as mild, not unassessable', () => {
    expect(severityFromSigns(['none_visible'], 0.9)).toBe('mild');
  });

  it('grades the signs that most warrant attention as severe', () => {
    expect(severityFromSigns(['heavy_bleeding'], 0.9)).toBe('severe');
    expect(severityFromSigns(['deformity', 'swelling'], 0.9)).toBe('severe');
    expect(severityFromSigns(['foreign_object'], 0.9)).toBe('severe');
  });

  it('grades bleeding, burns and open wounds as moderate', () => {
    expect(severityFromSigns(['bleeding'], 0.9)).toBe('moderate');
    expect(severityFromSigns(['burn', 'blistering'], 0.9)).toBe('moderate');
    expect(severityFromSigns(['open_wound'], 0.9)).toBe('moderate');
  });

  it('grades minor appearance signs as mild', () => {
    expect(severityFromSigns(['bruising'], 0.9)).toBe('mild');
    expect(severityFromSigns(['rash', 'discolouration'], 0.9)).toBe('mild');
  });

  it('takes the worst sign present, not the first or the most common', () => {
    expect(severityFromSigns(['bruising', 'rash', 'deformity'], 0.9)).toBe('severe');
  });
});

describe('compareObservations', () => {
  it('reports no trend for a first photo', () => {
    const result = compareObservations(undefined, { visibleSigns: ['bruising'], severity: 'mild' });
    expect(result.trend).toBe('unknown');
    expect(result.detail).toContain('First photo');
  });

  it('reports worsening when the appearance bucket rises, and names what is new', () => {
    const previous = observation({ visibleSigns: ['bruising'], severity: 'mild' });
    const result = compareObservations(previous, {
      visibleSigns: ['bruising', 'heavy_bleeding'],
      severity: 'severe',
    });
    expect(result.trend).toBe('worsening');
    expect(result.detail).toContain('heavy bleeding');
  });

  it('reports improving when the appearance bucket falls, and names what is gone', () => {
    const previous = observation({ visibleSigns: ['bleeding', 'swelling'], severity: 'moderate' });
    const result = compareObservations(previous, { visibleSigns: ['swelling'], severity: 'mild' });
    expect(result.trend).toBe('improving');
    expect(result.detail).toContain('bleeding');
  });

  it('reports stable only when nothing new appeared', () => {
    const previous = observation({ visibleSigns: ['swelling'], severity: 'mild' });
    const result = compareObservations(previous, { visibleSigns: ['swelling'], severity: 'mild' });
    expect(result.trend).toBe('stable');
  });

  it('will not claim stability when a new sign appeared at the same grade', () => {
    const previous = observation({ visibleSigns: ['bruising'], severity: 'mild' });
    const result = compareObservations(previous, { visibleSigns: ['bruising', 'rash'], severity: 'mild' });
    expect(result.trend).toBe('unknown');
    expect(result.detail).toContain('rash');
  });

  it('will not claim a direction when either photo was unassessable', () => {
    const previous = observation({ visibleSigns: [], severity: 'unable_to_assess' });
    const result = compareObservations(previous, { visibleSigns: ['bleeding'], severity: 'moderate' });
    expect(result.trend).toBe('unknown');

    const readablePrevious = observation({ visibleSigns: ['bleeding'], severity: 'moderate' });
    const blurred = compareObservations(readablePrevious, { visibleSigns: [], severity: 'unable_to_assess' });
    expect(blurred.trend).toBe('unknown');
  });
});

describe('severityLabel', () => {
  it('never phrases a severity as a diagnosis', () => {
    for (const label of [
      severityLabel('mild'),
      severityLabel('moderate'),
      severityLabel('severe'),
      severityLabel('unable_to_assess'),
    ]) {
      expect(label.toLowerCase()).not.toContain('definitely');
      expect(label.toLowerCase()).not.toMatch(/this is a|you have/);
    }
    expect(severityLabel('severe')).toBe('Appearance suggests higher concern');
  });
});
