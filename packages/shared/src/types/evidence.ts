/**
 * Evidence — the structured clinical facts accumulated during the interview.
 *
 * Design rule: evidence is APPEND-ONLY WITH SUPERSESSION. Nothing is ever
 * mutated or deleted in place. When a patient contradicts themselves ("no
 * shortness of breath" at 7:01, "I can't breathe" at 7:04), the new item
 * supersedes the old one and the old one stays on the record with
 * `supersededBy` set.
 *
 * This is not bookkeeping pedantry — it is what makes the spec's two headline
 * behaviours *provable* rather than asserted:
 *   - Contradiction detection (§2) compares against retained prior items.
 *   - The doctor-ready timeline (§5.4) can reconstruct exactly what was known
 *     at any instant, which is what a clinician actually needs at handoff.
 * A mutable `Record<conceptId, value>` would destroy both.
 */

import type { EvidenceId, IsoTimestamp, TurnId } from './common.js';

/**
 * Infermedica concept identifier.
 *   `s_*`  symptom        (e.g. `s_1193` severe headache)
 *   `p_*`  risk factor    (e.g. `p_8` smoking)
 *   `lt_*` lab test result
 * Free text is NOT accepted here — it must pass through the
 * EvidenceNormalizationPort (`/parse`) first. The `/triage` endpoint only
 * accepts concept ids, a step the original spec omitted.
 */
export type ConceptId = string;

export type ConceptType = 'symptom' | 'risk_factor' | 'lab_test';

/** Infermedica's answer vocabulary. `unknown` is explicitly recorded, not dropped. */
export type ChoiceId = 'present' | 'absent' | 'unknown';

/**
 * Where an observation came from. This matters for confidence scoring: a vital
 * sign reading and an offhand self-report are not equally reliable, and
 * `self_report` combined with a contradicting `vital` is the exact
 * "I'm fine but I fell" pattern from spec §2.
 */
export type EvidenceSource =
  /** The patient's opening complaint, before any question was asked. */
  | 'initial_complaint'
  /** A direct answer to a question the agent selected. */
  | 'question_answer'
  /** Extracted from a Groq-vision description of an uploaded injury photo (§5.7). */
  | 'photo_observation'
  /** Supplied by a caregiver in Family Relay Mode (§5.5). */
  | 'caregiver_report'
  /** A measured vital sign from the home dashboard (§9 screen 1). */
  | 'vital_measurement'
  /** Selected from the emergency quick-select symptom tags (§5.2). */
  | 'quick_select_tag'
  /** Pulled from the stored patient profile / emergency card (§5.6). */
  | 'patient_record'
  /** Produced by a Companion Mode reassessment sweep (§5.4). */
  | 'companion_reassessment';

/** How much weight the confidence layer should give this observation. */
export type EvidenceReliability =
  /** Measured or directly observed. */
  | 'measured'
  /** Patient stated it plainly and unambiguously. */
  | 'reported'
  /** Inferred from indirect signals (e.g. photo description, phrasing). */
  | 'inferred'
  /** Reported but contradicted by something else on record. */
  | 'disputed';

export interface EvidenceItem {
  readonly id: EvidenceId;
  readonly conceptId: ConceptId;
  readonly conceptType: ConceptType;
  /** Professional term from Infermedica, e.g. "Dyspnea". */
  readonly name: string;
  /** Plain-language term, used when talking to the patient, e.g. "shortness of breath". */
  readonly commonName?: string;
  readonly choiceId: ChoiceId;

  readonly source: EvidenceSource;
  readonly reliability: EvidenceReliability;

  /** The patient's own words that produced this item. Quoted verbatim on the handoff card (§5.3). */
  readonly rawText?: string;
  /** Turn during which this was captured. */
  readonly turnId?: TurnId;
  /** When the agent recorded it. */
  readonly observedAt: IsoTimestamp;
  /**
   * When the symptom itself began, if stated. Distinct from `observedAt` —
   * "it started an hour ago" is onset, not observation time. Drives the
   * `onset` field of the doctor handoff card.
   */
  readonly onsetAt?: IsoTimestamp;

  /** Set when a later item replaces this one. Retained, never deleted. */
  readonly supersededBy?: EvidenceId;
  /** Set on the replacement, pointing back at what it replaced. */
  readonly supersedes?: EvidenceId;
}

/** The shape `/triage` and `/diagnosis` actually accept. */
export interface InfermedicaEvidence {
  readonly id: ConceptId;
  readonly choice_id: ChoiceId;
  /** Infermedica distinguishes evidence the patient volunteered from evidence we asked about. */
  readonly source?: 'initial' | 'predefined' | 'suggest';
}

/**
 * Active evidence = everything not yet superseded. This is what gets sent to
 * the scoring engine; superseded items stay in state for the audit trail only.
 */
export function activeEvidence(items: readonly EvidenceItem[]): readonly EvidenceItem[] {
  return items.filter((item) => item.supersededBy === undefined);
}

/** Project active evidence into the wire format the scoring tool expects. */
export function toInfermedicaEvidence(
  items: readonly EvidenceItem[],
): readonly InfermedicaEvidence[] {
  return activeEvidence(items)
    .filter((item) => item.choiceId !== 'unknown')
    .map((item) => ({
      id: item.conceptId,
      choice_id: item.choiceId,
      source: item.source === 'initial_complaint' ? ('initial' as const) : ('predefined' as const),
    }));
}
