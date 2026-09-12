/**
 * Display labels for the quick-select symptom tags (spec §5.2).
 *
 * The app deliberately holds ONLY the labels and the tag strings. Mapping a tag
 * to an Infermedica concept id is the server's job (`resolveQuickSelectTag` in
 * @triage/agent) — importing that here would drag the whole orchestrator into
 * the phone bundle, and clinical concept mapping has no business running on a
 * client that can be decompiled.
 *
 * The tag strings must match `QUICK_SELECT_TAGS` in
 * packages/agent/src/quick-select.ts exactly; the server rejects anything it
 * cannot resolve.
 */

export interface QuickSelectOption {
  readonly tag: string;
  readonly label: string;
  /** Rough severity hint, for visual ordering only — never used clinically. */
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
