/**
 * Hospital matching (§5.3).
 *
 * DELIBERATE DEVIATION, flagged: the spec names Google Places for real
 * locations. Places requires a billing card even inside its free credit, and
 * this build is free-tier only. Real coordinates therefore come from
 * OpenStreetMap (Overpass / Nominatim — genuinely keyless). `HospitalPort`
 * hides the difference, so swapping Places back in is a one-file change.
 *
 * EVERYTHING ON THESE TYPES IS REAL SURVEYED DATA. There was previously a
 * simulated overlay here — deterministic fake bed counts and padded-out
 * specialty lists — carried alongside the real fields with `simulated: true`
 * markers to keep them distinguishable. It has been removed outright rather
 * than relabelled: in an emergency app, a plausible number next to a real
 * hospital's real phone number is read as fact no matter what the caption
 * says, and no public API publishes live bed counts to replace it with.
 *
 * The rule this file now enforces is simply: a field is present only when
 * OpenStreetMap actually carries it. Absent data stays absent.
 */

import type { GeoPoint, IsoTimestamp } from './common.js';

/** Specialties the router can require. Kept small and triage-relevant. */
export const HOSPITAL_SPECIALTIES = [
  'emergency',
  'cardiology',
  'neurology',
  'trauma',
  'burns',
  'orthopaedics',
  'paediatrics',
  'obstetrics',
  'toxicology',
  'general_medicine',
] as const;
export type HospitalSpecialty = (typeof HOSPITAL_SPECIALTIES)[number];

export interface Hospital {
  /** OpenStreetMap element id, e.g. `node/123456789`. Stable and free to use. */
  readonly osmId: string;
  readonly name: string;
  readonly location: GeoPoint;
  readonly address?: string;
  readonly phone?: string;
  /** From the OSM `operator:type` tag where present. */
  readonly isPublic?: boolean;

  /**
   * ONLY what OSM's `healthcare:speciality` tag actually declares, which for
   * most facilities is nothing — an empty array means "not surveyed", never
   * "none". Previously this was padded out deterministically from a hash of
   * the OSM id, which made every hospital appear to declare several.
   */
  readonly specialties: readonly HospitalSpecialty[];
  readonly hasEmergencyDepartment: boolean;
  /** Where the record came from. */
  readonly dataProvenance: {
    readonly location: 'openstreetmap' | 'google_places' | 'fixture';
  };
}

export interface HospitalMatch {
  readonly hospital: Hospital;
  readonly distanceKm: number;
  readonly estimatedTravelMinutes: number;
  /** Specialty the routing decision required, if any. */
  readonly requiredSpecialty?: HospitalSpecialty;
  readonly specialtyMatched: boolean;
  /** Why this one won over the others — shown in the reasoning panel. */
  readonly matchRationale: string;
  readonly matchedAt: IsoTimestamp;
}

/**
 * The pre-arrival packet pushed to the matched hospital's (simulated) endpoint.
 * Deliberately a distinct type from the doctor handoff card: this crosses a
 * system boundary and must never carry free-form model prose.
 */
export interface PreArrivalSummary {
  readonly caseId: string;
  readonly sentAt: IsoTimestamp;
  readonly destinationOsmId: string;
  readonly etaMinutes?: number;
  /** Simulated endpoint — no real hospital system is contacted. */
  readonly simulated: true;
  readonly acknowledged: boolean;
  readonly acknowledgedAt?: IsoTimestamp;
}
