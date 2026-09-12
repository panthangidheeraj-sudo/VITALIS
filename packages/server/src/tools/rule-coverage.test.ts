/**
 * Guards the seam between the scoring rules and the normalization lexicon.
 *
 * The rules in @triage/agent fire on concept ids. Those ids only ever reach
 * the scorer if the lexicon can produce them from something a patient might
 * say. If a concept is renamed on one side, the rule stops firing - silently,
 * because a rule that never matches looks exactly like a rule that matched and
 * found nothing. This test makes that a build failure instead.
 *
 * It lives in packages/server because that is the only package that can see
 * both the rules and the lexicon.
 */

import { describe, expect, it } from 'vitest';
import { COMBINATION_RED_FLAGS, SINGLE_RED_FLAGS } from '@triage/agent';
import { DEMO_LEXICON } from './demo-lexicon.js';

const PRODUCIBLE = new Set(
  DEMO_LEXICON.filter((e) => e.choiceId === 'present').map((e) => e.id),
);

describe('every red-flag rule can actually fire', () => {
  it('uses only concept ids the normalization layer can produce', () => {
    for (const rule of [...SINGLE_RED_FLAGS, ...COMBINATION_RED_FLAGS]) {
      for (const id of rule.requires) {
        expect(
          PRODUCIBLE.has(id),
          `Rule "${rule.label}" needs concept ${id}, which nothing in the lexicon emits. ` +
            'The rule would never fire and nobody would notice.',
        ).toBe(true);
      }
    }
  });

  it('states a basis for every rule it encodes', () => {
    // Each rule asserts a clinical claim. An unexplained claim cannot be
    // reviewed or challenged by a clinician, which is the whole advantage this
    // table has over a model.
    for (const rule of [...SINGLE_RED_FLAGS, ...COMBINATION_RED_FLAGS]) {
      expect(rule.basis.length, `"${rule.label}" has no stated basis`).toBeGreaterThan(30);
    }
  });

  it('keeps combination rules genuinely combinational', () => {
    for (const rule of COMBINATION_RED_FLAGS) {
      expect(rule.requires.length).toBeGreaterThan(1);
    }
    for (const rule of SINGLE_RED_FLAGS) {
      expect(rule.requires.length).toBe(1);
    }
  });
});
