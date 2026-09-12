/**
 * Hospital matching (§5.3).
 *
 * DELIBERATE DEVIATION, flagged: the spec names Google Places for real
 * locations. Places requires a billing card even inside its free credit, and
 * this build is free-tier only. Real coordinates therefore come from
 * OpenStreetMap (Overpass / Nominatim — genuinely keyless), layered with the
 * mock specialty + bed-availability dataset exactly as the spec intends, since
 * no public API exposes live bed counts anyway. `HospitalPort` hides the
 * difference, so swapping Places back in is a one-file change.
 *
 * `bedAvailability` and `specialties` are SIMULATED and every record says so.
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

/** Simulated capacity. Never presented as live hospital data. */
export interface BedAvailability {
  readonly simulated: true;
  readonly emergencyBedsFree: number;
  readonly icuBedsFree: number;
  readonly totalEmergencyBeds: number;
  readonly lastUpdated: IsoTimestamp;
}

export interface Hospital {
  /** OpenStreetMap element id, e.g. `node/123456789`. Stable and free to use. */
  readonly osmId: string;
  readonly name: string;
  readonly location: GeoPoint;
  readonly address?: string;
  readonly phone?: string;
  /** Real, from OSM tags where present. */
  readonly isPublic?: boolean;

  /** Simulated overlay — see file header. */
  readonly specialties: readonly HospitalSpecialty[];
  readonly bedAvailability: BedAvailability;
  readonly hasEmergencyDepartment: boolean;
  /** Which fields came from OSM versus the mock overlay. Shown in the UI. */
  readonly dataProvenance: {
    readonly location: 'openstreetmap' | 'google_places' | 'fixture';
    readonly specialties: 'simulated';
    readonly bedAvailability: 'simulated';
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
