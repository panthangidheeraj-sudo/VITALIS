/**
 * Hospital lookup straight from the user's browser — the fallback for when the
 * VITALIS server cannot reach Overpass.
 *
 * WHY THIS EXISTS. The server asks the public Overpass instances on the
 * user's behalf, from Render's shared IP range. Public Overpass operators
 * throttle or block shared hosting IPs (one tenant's abuse is everyone's),
 * and in production every mirror failed from there while the same mirrors
 * answered from other networks — so "nearby hospitals" was unavailable for
 * reasons no code on the server can change. The patient's own phone is on a
 * different network, is not on those blocklists, and can speak to the
 * instances directly (they send `Access-Control-Allow-Origin: *`).
 *
 * SAME RULES AS THE SERVER PORT (osm-hospital-port.ts), restated because
 * they are the point: real OpenStreetMap elements only, a record with no name
 * is dropped rather than shown as "Unnamed hospital", nothing is padded in,
 * and a field OSM does not carry is simply absent. Mirrors are raced and the
 * first NON-EMPTY answer wins, so a regional extract answering 200 with zero
 * elements cannot beat a real one.
 */

import type { NearbyHospital } from '../api/client';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

const TIMEOUT_MS = 14_000;

interface OverpassElement {
  readonly type: string;
  readonly id: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly center?: { readonly lat: number; readonly lon: number };
  readonly tags?: Record<string, string>;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function toHospital(el: OverpassElement, origin: { lat: number; lng: number }): NearbyHospital | undefined {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const tags = el.tags ?? {};
  const name = tags['name'] ?? tags['official_name'];
  if (lat === undefined || lng === undefined || name === undefined) return undefined;

  const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city'], tags['addr:postcode']]
    .filter((p): p is string => p !== undefined && p.length > 0)
    .join(', ');
  const phone = tags['phone'] ?? tags['contact:phone'] ?? tags['emergency:phone'];
  const operatorType = tags['operator:type'];

  return {
    osmId: `${el.type}/${el.id}`,
    name,
    location: { lat, lng },
    ...(address.length > 0 ? { address } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(operatorType !== undefined ? { isPublic: operatorType === 'public' || operatorType === 'government' } : {}),
    specialties: [],
    hasEmergencyDepartment: tags['emergency'] !== 'no',
    dataProvenance: { location: 'openstreetmap' },
    distanceKm: Number(haversineKm(origin, { lat, lng }).toFixed(2)),
  };
}

async function askMirror(url: string, query: string, signal: AbortSignal): Promise<readonly OverpassElement[]> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!response.ok) throw new Error(`mirror ${response.status}`);
  const json = (await response.json()) as { elements?: readonly OverpassElement[] };
  const elements = json.elements ?? [];
  // Rejecting an empty answer is what lets Promise.any keep waiting for a mirror
  // that actually has data; the genuinely-empty case is handled by the caller.
  if (elements.length === 0) throw new Error('empty');
  return elements;
}

/** Resolves with real hospitals, `[]` if every mirror answered "none here", and rejects if none could be reached. */
export async function findHospitalsDirect(
  origin: { lat: number; lng: number },
  radiusKm = 10,
  limit = 5,
): Promise<readonly NearbyHospital[]> {
  const query = `[out:json][timeout:12];nwr(around:${Math.round(radiusKm * 1000)},${origin.lat},${origin.lng})[amenity=hospital];out center ${Math.min(limit * 4, 40)};`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const elements = await Promise.any(MIRRORS.map((url) => askMirror(url, query, controller.signal)));
    return elements
      .map((el) => toHospital(el, origin))
      .filter((h): h is NearbyHospital => h !== undefined)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
  } catch (err) {
    // Every mirror failed. If they all failed ONLY because they were empty,
    // that is a real "no hospitals in range"; anything else is unreachable.
    if (err instanceof AggregateError && err.errors.every((e) => e instanceof Error && e.message === 'empty')) return [];
    throw err;
  } finally {
    window.clearTimeout(timer);
    controller.abort();
  }
}
