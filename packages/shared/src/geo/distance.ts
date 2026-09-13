/**
 * Distance and travel-time estimation.
 *
 * Lives in @triage/shared because three places need the same number and must
 * not each invent their own: the hospital adapter ranks candidates by it, the
 * agent records it on `HospitalMatch`, and the tracking screen shows it. Two
 * different distance functions in one system means the list is sorted by one
 * number and labelled with another.
 */

import type { GeoPoint } from '../types/common.js';

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance in kilometres. Accurate to well under a percent at
 * city scale, which is the only scale this is used at.
 *
 * This is STRAIGHT-LINE distance, not road distance - a free routing API with
 * no billing card does not exist. Everything that renders it must say "approx",
 * because in a city with a river through it the real drive can be double.
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Average effective speed for an urban emergency journey, in km/h.
 *
 * Deliberately pessimistic. An ETA that arrives early is a pleasant surprise;
 * an ETA that passes while an ambulance is still in traffic is the moment
 * someone decides the app is lying to them and stops believing the rest of it.
 */
const URBAN_SPEED_KMH = 25;

/**
 * Estimated travel minutes, rounded up and floored at one.
 *
 * A straight-line distance understates the real journey, so the low speed
 * above is doing double duty as a detour allowance. Callers must present this
 * as an estimate, never as a countdown.
 */
export function estimateTravelMinutes(distanceKm: number): number {
  return Math.max(1, Math.ceil((distanceKm / URBAN_SPEED_KMH) * 60));
}
