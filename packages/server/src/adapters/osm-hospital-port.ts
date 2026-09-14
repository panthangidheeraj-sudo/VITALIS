/**
 * Hospital matching against OpenStreetMap - the real half of `HospitalPort`.
 *
 * WHY OSM AND NOT GOOGLE PLACES: Places requires a billing card even inside its
 * free credit. This build is free-tier only, so coordinates come from the
 * Overpass API, which is genuinely keyless. `HospitalPort` hides the
 * difference; swapping Places back in is a one-file change.
 *
 * EVERY FIELD HERE IS SURVEYED DATA. This adapter used to carry a simulated
 * overlay - bed counts and padded specialty lists derived from a hash of the
 * OSM id - labelled `simulated: true` so a consumer could tell them apart.
 * Both are gone. Nothing is generated; a hospital that OSM has no phone number
 * for simply has no phone number.
 *
 * ---------------------------------------------------------------------------
 * OVERPASS RELIABILITY, WHICH IS THE OTHER POINT OF THIS FILE
 *
 * Overpass is a free service on donated capacity, and the main endpoint fails
 * often enough that a single-endpoint client is a broken feature. Measured
 * against overpass-api.de from one machine, minutes apart: HTTP 200 in 3.5s,
 * then HTTP 504 with an XML error body, then 200 again. Other public instances
 * returned HTTP 504 after 98 SECONDS, or failed at the transport layer
 * outright ("fetch failed"). A deployed host makes this worse, not better:
 * Overpass rate-limits per IP, and on a shared platform that IP is shared with
 * every other tenant on the box.
 *
 * So the client tries a list of instances in order, moving on when one fails,
 * with a per-instance timeout short enough that exhausting the list still
 * finishes in a sane time. Three further details matter:
 *
 *   - A 504 from Overpass arrives as an XML/HTML error document with an HTTP
 *     error status, and its "query timed out" variant can even arrive as 200.
 *     Both are treated as failures and trigger failover.
 *   - Only GLOBAL instances belong in the list. Regional extracts
 *     (overpass.osm.ch, overpass.osm.jp) answer fast and successfully with
 *     ZERO elements outside their region - which would render as "no hospitals
 *     near you" to someone standing next to one.
 *   - Results are cached per rounded coordinate. Hospitals do not move, and
 *     hammering a donated service is both rude and the fastest way to get
 *     rate-limited mid-emergency.
 * ---------------------------------------------------------------------------
 */

import type {
  Hospital,
  HospitalPort,
  HospitalSearchRequest,
  HospitalSpecialty,
  PreArrivalSummary,
  ToolError,
  ToolResult,
} from '@triage/shared';
import { HOSPITAL_SPECIALTIES, failedResult, fallbackResult, haversineKm, liveResult } from '@triage/shared';
import { requestJson } from './http.js';

export interface OsmHospitalConfig {
  /** Primary instance; tried first, then FALLBACK_OVERPASS_URLS in order. */
  readonly overpassUrl: string;
  /** Courtesy contact for the User-Agent. Not a credential; may be absent. */
  readonly contactEmail?: string;
}

/**
 * Tried after the configured primary, in order. GLOBAL instances only - see
 * the file header on why a regional extract is worse than an outright error.
 */
const FALLBACK_OVERPASS_URLS: readonly string[] = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

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

/**
 * ONE attempt per instance, not two. Retrying the same struggling endpoint is
 * how the old 25s x 2 budget turned one bad instance into a 50-second wait;
 * moving to the next instance is both faster and likelier to work. A healthy
 * Overpass answers this query in 3-4s, so 12s is generous, and the whole
 * three-instance walk still finishes inside ~36s worst case.
 */
const OVERPASS_POLICY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  timeoutMs: 12_000,
} as const;

/** Cache lifetime. Hospitals do not move; this only bounds staleness of edits. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * How long a cached result may still be served AFTER every instance has
 * failed. A day-old list of real hospitals beats an error message, because the
 * thing that actually changed in that day is nothing: buildings do not move,
 * and the entry was real OSM data when it was fetched. This is a fallback, so
 * the result is returned as `fallbackResult` with a notice, never as `live`.
 */
const STALE_CACHE_MAX_MS = 24 * 60 * 60 * 1000;

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
    //
    // The server-side `[timeout:10]` is deliberately BELOW our own 12s budget:
    // it makes Overpass abandon an over-long query itself rather than holding
    // the connection open until we abort it, which is the polite behaviour
    // toward a donated service and gets us to the next instance sooner.
    const query = `[out:json][timeout:10];nwr(around:${radiusM},${request.origin.lat},${request.origin.lng})[amenity=hospital];out center ${Math.min(request.limit * 4, 40)};`;

    const endpoints = [this.config.overpassUrl, ...FALLBACK_OVERPASS_URLS.filter((u) => u !== this.config.overpassUrl)];
    let elements: readonly OverpassElement[] | undefined;
    let totalLatencyMs = 0;
    let lastError: ToolError | undefined;

    for (const endpoint of endpoints) {
      const outcome = await requestJson<OverpassResponse>(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        policy: OVERPASS_POLICY,
      });
      totalLatencyMs += outcome.latencyMs;

      // An Overpass instance under load answers with an XML/HTML error
      // document, which `requestJson` surfaces as an invalid_response rather
      // than a transport error - so BOTH shapes have to fail over, not just
      // the dead-socket one.
      if (outcome.ok && outcome.value !== undefined) {
        elements = outcome.value.elements ?? [];
        break;
      }
      lastError = outcome.error ?? { kind: 'unavailable', message: 'Overpass unreachable.', retryable: true };
      // Per-instance, because "hospitals are unavailable" is indistinguishable
      // from "this one instance is rate-limiting us" without it — and which
      // one it is decides whether to reorder the list or just wait.
      console.warn(`[osm] overpass instance failed (${lastError.kind}): ${lastError.message}`);
    }

    if (elements === undefined) {
      // Every instance failed. If this area was looked up recently enough,
      // serve that real (if stale) list rather than nothing — labelled as a
      // fallback so the caller knows it is not a fresh lookup.
      if (cached !== undefined && Date.now() - cached.at < STALE_CACHE_MAX_MS) {
        return fallbackResult(cached.hospitals, totalLatencyMs, {
          tool: 'osm.find_hospitals',
          reason: 'unavailable',
          userFacingMessage:
            'Showing the last hospital list found for this area — the map service is temporarily unavailable, so it may be out of date.',
          fallbackUsed: 'cached OpenStreetMap results for the same area',
          conservative: true,
        });
      }
      return failedResult(
        lastError ?? { kind: 'unavailable', message: 'Overpass unreachable.', retryable: true },
        totalLatencyMs,
        {
          tool: 'osm.find_hospitals',
          reason: 'unavailable',
          // Safe to show verbatim: no URL, no status code, no transport
          // detail. The second clause is §6 — the patient is told the
          // assessment itself is unaffected, so a failed list does not read
          // as "the app is broken, you are on your own".
          userFacingMessage:
            'Nearby hospitals are temporarily unavailable. Please try again — in an emergency, call the emergency number and they will route you.',
          fallbackUsed: 'no hospital matched; the routing decision itself is unaffected',
          conservative: true,
        },
      );
    }

    const hospitals = elements
      .map((element) => toHospital(element, request.origin))
      .filter((h): h is RankedHospital => h !== undefined)
      .filter((h) => !request.requireEmergencyDepartment || h.hospital.hasEmergencyDepartment)
      // Now that specialties are only what OSM actually declares, this filter
      // is genuinely restrictive rather than decorative - it used to match
      // against a padded list that always contained 'emergency'. No caller
      // passes `requiredSpecialty` today; one that did would correctly get
      // only hospitals that really declare it, and an empty list otherwise.
      .filter(
        (h) =>
          request.requiredSpecialty === undefined ||
          h.hospital.specialties.includes(request.requiredSpecialty),
      )
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, request.limit)
      .map((h) => h.hospital);

    this.cache.set(key, { at: Date.now(), hospitals });
    return liveResult(hospitals, totalLatencyMs);
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
      specialties: declaredSpecialties(tags),
      dataProvenance: { location: 'openstreetmap' },
    },
  };
}

/**
 * ONLY what the `healthcare:speciality` tag actually declares. Most hospitals
 * declare nothing, and an empty list is the correct answer for those - it
 * means "not surveyed", and the UI shows nothing rather than a guess.
 */
function declaredSpecialties(tags: Record<string, string>): readonly HospitalSpecialty[] {
  return [
    ...new Set(
      (tags['healthcare:speciality'] ?? '')
        .split(';')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is HospitalSpecialty => (HOSPITAL_SPECIALTIES as readonly string[]).includes(s)),
    ),
  ];
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

function cacheKey(request: HospitalSearchRequest): string {
  // ~1 km granularity: two people in the same neighbourhood share one lookup.
  const lat = request.origin.lat.toFixed(2);
  const lng = request.origin.lng.toFixed(2);
  return `${lat},${lng},${request.radiusKm},${request.requiredSpecialty ?? '-'},${request.requireEmergencyDepartment}`;
}
