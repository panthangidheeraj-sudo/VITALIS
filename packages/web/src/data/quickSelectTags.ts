/**
 * Ported verbatim from packages/mobile/src/data/quickSelectTags.ts — the tag
 * strings must match `QUICK_SELECT_TAGS` in packages/agent/src/quick-select.ts
 * exactly, the server rejects anything it cannot resolve.
 */

export interface QuickSelectOption {
  readonly tag: string;
  readonly label: string;
  readonly critical: boolean;
}

export const QUICK_SELECT_OPTIONS: readonly QuickSelectOption[] = [
  { tag: 'chest_pain', label: 'Chest pain', critical: true },
  { tag: 'shortness_of_breath', label: 'Shortness of breath', critical: true },
  { tag: 'severe_bleeding', label: 'Severe bleeding', critical: true },
  { tag: 'paralysis', label: 'Paralysis', critical: true },
  { tag: 'coughing_blood', label: 'Coughing blood', critical: true },
  { tag: 'head_injury', label: 'Head injury', critical: true },
  { tag: 'severely_burned', label: 'Severe burn', critical: true },
  { tag: 'abdominal_pain', label: 'Abdominal pain', critical: false },
  { tag: 'dizziness', label: 'Dizziness', critical: false },
  { tag: 'vomiting', label: 'Vomiting', critical: false },
  { tag: 'shaking', label: 'Shaking', critical: false },
];
