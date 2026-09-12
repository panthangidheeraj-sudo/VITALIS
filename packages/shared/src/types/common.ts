/**
 * Primitives shared across every contract in the system.
 *
 * Timestamps are ISO-8601 strings rather than `Date` or a Firestore `Timestamp`
 * so that the exact same object can live in Firestore, cross the wire to the
 * PWA, and be committed to a JSON fixture without a conversion layer at each
 * boundary. The demo fixture has to be byte-comparable with what the live
 * system produces, otherwise it stops being a real acceptance test.
 */

/** ISO-8601 instant, always UTC with a `Z` suffix. e.g. `2026-09-12T07:04:00.000Z` */
export type IsoTimestamp = string;

/** Milliseconds. Used for tool latency and reassessment intervals. */
export type Millis = number;

// --- Identifiers -------------------------------------------------------------
// Branded so a TurnId can never be passed where a CaseId is expected. The brand
// is erased at runtime; these are plain strings in Firestore and JSON.

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type CaseId = Brand<string, 'CaseId'>;
export type TurnId = Brand<string, 'TurnId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type TimelineEntryId = Brand<string, 'TimelineEntryId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type PatientId = Brand<string, 'PatientId'>;
export type ContactId = Brand<string, 'ContactId'>;

/**
 * A Firebase Auth uid. Branded like the rest so it cannot be confused with a
 * PatientId — they look identical (opaque strings) but mean different things:
 * a Uid identifies a DEVICE/sign-in, a PatientId identifies a person. One
 * patient can be reached from several devices, and an anonymous uid is
 * regenerated if the app's storage is cleared.
 */
export type Uid = Brand<string, 'Uid'>;

/** Unsafe casts, for use only at trust boundaries (schema parse, ID generation). */
export const asCaseId = (v: string): CaseId => v as CaseId;
export const asTurnId = (v: string): TurnId => v as TurnId;
export const asEvidenceId = (v: string): EvidenceId => v as EvidenceId;
export const asTimelineEntryId = (v: string): TimelineEntryId => v as TimelineEntryId;
export const asToolCallId = (v: string): ToolCallId => v as ToolCallId;
export const asPatientId = (v: string): PatientId => v as PatientId;
export const asContactId = (v: string): ContactId => v as ContactId;
export const asUid = (v: string): Uid => v as Uid;

// --- Language ----------------------------------------------------------------

/**
 * Spec §5.6: Telugu, Hindi, Tamil, English at minimum.
 * Groq preserves *tone* across these, not just literal meaning (§8).
 */
export const SUPPORTED_LANGUAGES = ['en', 'hi', 'te', 'ta'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  hi: 'हिन्दी (Hindi)',
  te: 'తెలుగు (Telugu)',
  ta: 'தமிழ் (Tamil)',
};

// --- Citation ----------------------------------------------------------------

/**
 * Spec §7: the assistant cites sources for external claims and flags explicitly
 * when something is *not* sourced. A claim with no `Citation` must be rendered
 * as unsourced rather than silently presented as fact.
 */
export interface Citation {
  /** Which knowledge tool produced this. */
  readonly provider: 'medlineplus' | 'infermedica' | 'rxnorm' | 'icd11' | 'wikipedia';
  /** Human-readable source title, e.g. "MedlinePlus: Chest Pain". */
  readonly title: string;
  readonly url?: string;
  /** Concept this citation backs, e.g. an Infermedica `s_` id or an ICD-11 code. */
  readonly conceptId?: string;
  readonly retrievedAt: IsoTimestamp;
}

// --- Geo ---------------------------------------------------------------------

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
  /** Reported accuracy radius in metres, when the browser provides one. */
  readonly accuracyM?: number;
}

export interface GeoFix extends GeoPoint {
  readonly at: IsoTimestamp;
  readonly source: 'browser_geolocation' | 'manual_entry' | 'caregiver_report' | 'fixture';
}
