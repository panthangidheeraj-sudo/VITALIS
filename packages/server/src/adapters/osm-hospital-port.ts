/**
 * Hospital matching against OpenStreetMap - the real half of `HospitalPort`.
 *
 * WHY OSM AND NOT GOOGLE PLACES: Places requires a billing card even inside its
 * free credit. This build is free-tier only, so coordinates come from the
 * Overpass API, which is genuinely keyless. `HospitalPort` hides the
 * difference; swapping Places back in is a one-file change.
 *
 * ---------------------------------------------------------------------------
 * THE PROVENANCE SPLIT, WHICH IS THE POINT OF THIS FILE
 *
 * Everything here is one of two things, and each record says which:
 *
 *   REAL, from OSM   - name, coordinates, address, phone, emergency=yes tag
 *   SIMULATED        - specialties, bed availability
 *
 * No public API publishes live bed counts anywhere in the world, so the beds
 * are invented. The dishonest version of this adapter would blend the two and
 * present "3 emergency beds free" next to a real hospital's real phone number
 * as though both came from the same place. `dataProvenance` on every record,
 * plus `simulated: true` inside `bedAvailability`, is what stops the UI from
 * being able to make that mistake even by accident.
 *
 * The simulation is DETERMINISTIC - derived from the OSM id - rather than
 * random. A hospital that has three free beds must still have three free beds
 * when the screen refreshes thirty seconds later, or the demo contradicts
 * itself on camera.
 * ---------------------------------------------------------------------------
 *
 * Overpass is a shared free service run on donated capacity. The query is
 * bounded (radius, timeout, element cap) and results are cached per rounded
 * coordinate, because hammering it during a demo is both rude and the fastest
 * way to get rate-limited mid-presentation.
 */

import type {
  Hospital,
  HospitalPort,
  HospitalSearchRequest,
  HospitalSpecialty,
  PreArrivalSummary,
  ToolResult,
} from '@triage/shared';
import { HOSPITAL_SPECIALTIES, failedResult, haversineKm, liveResult } from '@triage/shared';
import { requestJson } from './http.js';

export interface OsmHospitalConfig {
  readonly overpassUrl: string;
  /** Courtesy contact for the User-Agent. Not a credential; may be absent. */
  readonly contactEmail?: string;
}

interface OverpassElement {
  readonly type: 'node' | 'way' | 'relation';
  readonly id: number;
  readonly lat?: number;
  readonly lon?: number;
  /** Ways and relations have no lat/lon of their own; `out center` adds this. */
  readonly center?: { readonly lat: number; readonly lon: number };
  readonly tags?: Record<string, string>;
}

interface OverpassResponse {
  readonly elements?: readonly OverpassElement[];
}

/** Overpass is slow and shared; give it more room than a clinical call gets. */
const OVERPASS_POLICY = {
  maxAttempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 2000,
  timeoutMs: 25_000,
} as const;

/** Cache lifetime. Hospitals do not move; this only bounds staleness of edits. */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  readonly at: number;
  readonly hospitals: readonly Hospital[];
}

export class OsmHospitalPort implements HospitalPort {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: OsmHospitalConfig) {}

  async findNearby(request: HospitalSearchRequest): Promise<ToolResult<readonly Hospital[]>> {
    const key = cacheKey(request);
    const cached = this.cache.get(key);
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return liveResult(cached.hospitals, 0);
    }

    const radiusM = Math.round(request.radiusKm * 1000);
    // `nwr` covers nodes, ways and relations in one pass - large hospitals are
    // mapped as building outlines (ways), not points, and a node-only query
    // misses exactly the big facilities an emergency needs.
    const query = `[out:json][timeout:20];nwr(around:${radiusM},${request.origin.lat},${request.origin.lng})[amenity=hospital];out center ${Math.min(request.limit * 4, 40)};`;

    const outcome = await requestJson<OverpassResponse>(this.config.overpassUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      policy: OVERPASS_POLICY,
    });

    if (!outcome.ok || outcome.value === undefined) {
      return failedResult(
        outcome.error ?? { kind: 'unavailable', message: 'Overpass unreachable.', retryable: true },
        outcome.latencyMs,
        {
          tool: 'osm.find_hospitals',
          reason: 'unavailable',
          userFacingMessage:
            'I could not look up nearby hospitals. Call the emergency number and they will route you.',
          fallbackUsed: 'no hospital matched; the routing decision itself is unaffected',
          conservative: true,
        },
      );
    }

    const hospitals = (outcome.value.elements ?? [])
      .map((element) => toHospital(element, request.origin))
      .filter((h): h is RankedHospital => h !== undefined)
      .filter((h) => !request.requireEmergencyDepartment || h.hospital.hasEmergencyDepartment)
      .filter(
        (h) =>
          request.requiredSpecialty === undefined ||
          h.hospital.specialties.includes(request.requiredSpecialty),
      )
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, request.limit)
      .map((h) => h.hospital);

    this.cache.set(key, { at: Date.now(), hospitals });
    return liveResult(hospitals, outcome.latencyMs);
  }

  /**
   * SIMULATED, and typed so it cannot pretend otherwise (`simulated: true` is a
   * literal on `PreArrivalSummary`). No real hospital accepts an unauthenticated
   * pre-arrival packet from a hackathon project, and inventing an endpoint that
   * appears to succeed would be the single most misleading thing in this
   * codebase. It records the intent on the case and acknowledges immediately.
   */
  async pushPreArrival(input: {
    readonly caseId: string;
    readonly osmId: string;
  }): Promise<ToolResult<PreArrivalSummary>> {
    const at = new Date().toISOString();
    return liveResult(
      {
        caseId: input.caseId,
        sentAt: at,
        destinationOsmId: input.osmId,
        simulated: true,
        acknowledged: true,
        acknowledgedAt: at,
      },
      0,
    );
  }
}

interface RankedHospital {
  readonly hospital: Hospital;
  readonly distanceKm: number;
}

function toHospital(
  element: OverpassElement,
  origin: { readonly lat: number; readonly lng: number },
): RankedHospital | undefined {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const tags = element.tags ?? {};
  const name = tags['name'] ?? tags['official_name'];
  // An unnamed polygon is unusable: it cannot be read out to a patient, spoken
  // to a driver, or printed on a handoff card. Dropped rather than shown as
  // "Unnamed hospital".
  if (lat === undefined || lon === undefined || name === undefined) return undefined;

  const osmId = `${element.type}/${element.id}`;
  const address = formatAddress(tags);
  const phone = tags['phone'] ?? tags['contact:phone'] ?? tags['emergency:phone'];
  const operatorType = tags['operator:type'];

  return {
    distanceKm: haversineKm(origin, { lat, lng: lon }),
    hospital: {
      osmId,
      name,
      location: { lat, lng: lon },
      ...(address !== undefined ? { address } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(operatorType !== undefined
        ? { isPublic: operatorType === 'public' || operatorType === 'government' }
        : {}),
      // OSM's `emergency=yes` is the real signal where it is tagged. Where it is
      // absent the tag simply was not surveyed - so an untagged hospital is
      // assumed to have an emergency department rather than being excluded. In
      // this direction the error is a wasted extra option; the other direction
      // hides a real ED from someone who needs one.
      hasEmergencyDepartment: tags['emergency'] !== 'no',
      specialties: simulatedSpecialties(osmId, tags),
      bedAvailability: simulatedBeds(osmId),
      dataProvenance: {
        location: 'openstreetmap',
        specialties: 'simulated',
        bedAvailability: 'simulated',
      },
    },
  };
}

function formatAddress(tags: Record<string, string>): string | undefined {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'],
    tags['addr:city'],
    tags['addr:postcode'],
  ].filter((p): p is string => p !== undefined && p.length > 0);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * A small, stable hash of the OSM id.
 *
 * The simulated overlay has to be the SAME on every call, or a hospital gains
 * and loses ICU beds each time the screen re-renders. Deriving it from the id
 * rather than from `Math.random()` is what makes the simulation reproducible
 * for a recorded demo.
 */
function seedOf(osmId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < osmId.length; i += 1) {
    hash ^= osmId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * SIMULATED. Where OSM actually carries `healthcare:speciality` the real values
 * are used and the rest are padded deterministically - a partially-real list is
 * still labelled simulated as a whole, because a consumer cannot tell which
 * entries were surveyed and which were invented.
 */
function simulatedSpecialties(
  osmId: string,
  tags: Record<string, string>,
): readonly HospitalSpecialty[] {
  const declared = (tags['healthcare:speciality'] ?? '')
    .split(';')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is HospitalSpecialty =>
      (HOSPITAL_SPECIALTIES as readonly string[]).includes(s),
    );

  const set = new Set<HospitalSpecialty>(declared);
  set.add('emergency');
  set.add('general_medicine');

  const seed = seedOf(osmId);
  const optional: readonly HospitalSpecialty[] = [
    'cardiology',
    'neurology',
    'trauma',
    'orthopaedics',
    'paediatrics',
  ];
  for (let i = 0; i < optional.length; i += 1) {
    if (((seed >> i) & 1) === 1) set.add(optional[i]!);
  }
  return [...set];
}

/** SIMULATED. See the file header - no public API publishes live bed counts. */
function simulatedBeds(osmId: string) {
  const seed = seedOf(osmId);
  const totalEmergencyBeds = 12 + (seed % 29);
  return {
    simulated: true as const,
    totalEmergencyBeds,
    emergencyBedsFree: (seed >> 5) % Math.max(1, Math.floor(totalEmergencyBeds / 2)),
    icuBedsFree: (seed >> 11) % 6,
    lastUpdated: new Date().toISOString(),
  };
}

function cacheKey(request: HospitalSearchRequest): string {
  // ~1 km granularity: two people in the same neighbourhood share one lookup.
  const lat = request.origin.lat.toFixed(2);
  const lng = request.origin.lng.toFixed(2);
  return `${lat},${lng},${request.radiusKm},${request.requiredSpecialty ?? '-'},${request.requireEmergencyDepartment}`;
}
