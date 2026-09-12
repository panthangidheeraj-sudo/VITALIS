/**
 * Patient identity, the One-Tap Emergency Card (§5.6), and vitals (§9 screen 1).
 */

import type { ContactId, IsoTimestamp, Language, PatientId } from './common.js';

/** Infermedica's `/triage` requires biological sex for its inference engine. */
export type BiologicalSex = 'male' | 'female';

export interface PatientDemographics {
  readonly ageYears: number;
  readonly sex: BiologicalSex;
  readonly displayName?: string;
  readonly preferredLanguage: Language;
  /** Set when the patient is a minor — raises the `minor` communication state (§8). */
  readonly isMinor: boolean;
}

/** A medication as the patient typed it, plus its RxNorm-normalised form (§6). */
export interface Medication {
  /** Exactly what the patient wrote. Never overwritten. */
  readonly reportedName: string;
  /** RxNorm concept unique identifier, once normalised. */
  readonly rxcui?: string;
  /** Standardised name for the hospital pre-arrival summary. */
  readonly normalizedName?: string;
  readonly dose?: string;
  readonly frequency?: string;
  /** Interaction warnings surfaced by RxNav. Informational — never a prescription. */
  readonly interactionFlags?: readonly string[];
}

export type ContactRelationship =
  | 'spouse'
  | 'parent'
  | 'child'
  | 'sibling'
  | 'friend'
  | 'neighbour'
  | 'caregiver'
  | 'doctor'
  | 'other';

export interface EmergencyContact {
  readonly id: ContactId;
  readonly name: string;
  readonly relationship: ContactRelationship;
  /** E.164, e.g. `+919876543210`. */
  readonly phoneE164: string;
  readonly whatsappEnabled: boolean;
  readonly smsEnabled: boolean;
  /** Contacts are tried in this order. Lowest first. */
  readonly priority: number;
  /** May this contact take over the interview in Family Relay Mode (§5.5)? */
  readonly canRelay: boolean;
}

/** §5.6 — instantly accessible, works from the lock screen of the PWA. */
export interface EmergencyCard {
  readonly bloodGroup?: string;
  readonly allergies: readonly string[];
  readonly medications: readonly Medication[];
  readonly chronicConditions: readonly string[];
  readonly organDonor?: boolean;
  readonly notes?: string;
  readonly updatedAt: IsoTimestamp;
}

/** Home dashboard vitals (§9 screen 1). Feed the interview as `vital_measurement` evidence. */
export interface VitalReading {
  readonly kind:
    | 'blood_pressure'
    | 'blood_glucose'
    | 'spo2'
    | 'heart_rate'
    | 'temperature'
    | 'respiratory_rate';
  /** Systolic for blood pressure; the single value otherwise. */
  readonly value: number;
  /** Diastolic, blood pressure only. */
  readonly secondaryValue?: number;
  readonly unit: string;
  readonly measuredAt: IsoTimestamp;
  readonly source: 'manual_entry' | 'device' | 'caregiver' | 'fixture';
}

export interface PatientProfile {
  readonly id: PatientId;
  readonly demographics: PatientDemographics;
  readonly emergencyCard: EmergencyCard;
  readonly contacts: readonly EmergencyContact[];
  readonly recentVitals: readonly VitalReading[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** Contacts in dial/notify order, highest priority first. */
export function contactsByPriority(
  contacts: readonly EmergencyContact[],
): readonly EmergencyContact[] {
  return [...contacts].sort((a, b) => a.priority - b.priority);
}
