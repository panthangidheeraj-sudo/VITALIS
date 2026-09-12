/**
 * Quick-select symptom tags (spec §5.2) — the eleven buttons on the
 * "Are you in an Emergency?" screen. Tapping one is itself an Observe event:
 * it produces evidence exactly like an answered question does, without
 * requiring the patient to type or say anything, which matters for the
 * `panicked` and `minor` communication states where typing is hard.
 *
 * PLACEHOLDER CONCEPT IDS, same caveat as the fixture: shaped like real
 * Infermedica ids, not yet reconciled against a live `/search` response.
 * Tracked in the root README's "Open item".
 */

import type { ConceptId, ConceptType } from '@triage/shared';

export interface QuickSelectTag {
  readonly tag: string;
  readonly conceptId: ConceptId;
  readonly conceptType: ConceptType;
  readonly name: string;
  readonly commonName: string;
}

/** The exact eleven tags named in the spec, in the order given there. */
export const QUICK_SELECT_TAGS: readonly QuickSelectTag[] = [
  { tag: 'chest_pain', conceptId: 's_21', conceptType: 'symptom', name: 'Chest pain', commonName: 'chest pain' },
  { tag: 'coughing_blood', conceptId: 's_155', conceptType: 'symptom', name: 'Hemoptysis', commonName: 'coughing up blood' },
  { tag: 'paralysis', conceptId: 's_207', conceptType: 'symptom', name: 'Paralysis', commonName: 'paralysis' },
  { tag: 'severe_bleeding', conceptId: 's_1148', conceptType: 'symptom', name: 'Severe bleeding', commonName: 'severe bleeding' },
  { tag: 'head_injury', conceptId: 's_913', conceptType: 'symptom', name: 'Head injury', commonName: 'head injury' },
  { tag: 'severely_burned', conceptId: 's_1567', conceptType: 'symptom', name: 'Burn', commonName: 'severe burn' },
  { tag: 'dizziness', conceptId: 's_15', conceptType: 'symptom', name: 'Dizziness', commonName: 'dizziness' },
  { tag: 'shaking', conceptId: 's_267', conceptType: 'symptom', name: 'Tremor', commonName: 'shaking' },
  { tag: 'vomiting', conceptId: 's_16', conceptType: 'symptom', name: 'Vomiting', commonName: 'vomiting' },
  { tag: 'shortness_of_breath', conceptId: 's_13', conceptType: 'symptom', name: 'Dyspnea', commonName: 'shortness of breath' },
  { tag: 'abdominal_pain', conceptId: 's_99', conceptType: 'symptom', name: 'Abdominal pain', commonName: 'abdominal pain' },
] as const;

const BY_TAG = new Map(QUICK_SELECT_TAGS.map((t) => [t.tag, t]));

export function resolveQuickSelectTag(tag: string): QuickSelectTag | undefined {
  return BY_TAG.get(tag);
}
