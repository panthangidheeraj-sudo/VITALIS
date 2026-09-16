/**
 * The actual map HospitalsPanel was missing.
 *
 * Before this, "Nearby hospitals" was a text list with a distance figure and
 * a "Directions" link that opened a separate app — real data, but nothing on
 * this screen showed WHERE any of it was relative to the patient, which is
 * exactly the thing a map answers and a list of numbers doesn't. This is an
 * actual Leaflet map over OpenStreetMap tiles: the same free, keyless data
 * source the hospital search itself already uses (see osm-hospital-port.ts),
 * so nothing new needed a credential or a paid quota.
 *
 * Dynamically imported, same reasoning as FloatingLines.tsx's `three`
 * import: Leaflet is real weight (~40KB gzipped) that only Emergency, and
 * only once a search has actually returned hospitals, ever needs — a static
 * import would put it in every page's bundle for a component most sessions
 * never render.
 *
 * NO DEFAULT MARKER ICONS. Leaflet's stock marker images resolve to relative
 * URLs that do not survive a bundler without extra asset-path configuration
 * (a well-known Leaflet+Vite papercut) — sidestepped entirely by drawing
 * markers as small `L.divIcon` dots styled with the app's own CSS instead of
 * loading any image asset.
 */

import { useEffect, useRef } from 'react';
import type * as LEAFLET_TYPES from 'leaflet';
import type { NearbyHospital } from '../api/client';

/**
 * LEAFLET IS LOADED FROM COMMITTED STATIC FILES, NOT FROM `node_modules`.
 *
 * `public/vendor/leaflet.js` and `public/vendor/leaflet.css` are verbatim
 * copies of leaflet@1.9.4's `dist/` files. Vite serves `public/` as-is, so
 * neither one goes through package resolution at build time.
 *
 * WHY, because this looks unusual and should not be "tidied up" back into
 * imports: Render builds this service with `yarn`, while the repo is an
 * npm-workspaces monorepo — `package-lock.json`, no `yarn.lock`. Yarn does
 * not read npm's lockfile, and Render's cached `node_modules` predates
 * leaflet being added, so on Render the package is simply absent. Two
 * builds failed there in a row on exactly that, one import at a time:
 *
 *   Rollup failed to resolve import "leaflet/dist/leaflet.css?url"   (fixed first)
 *   Rollup failed to resolve import "leaflet"                        (this one)
 *
 * Both are the same root cause, and chasing them import-by-import only
 * finds the next one. Serving the library as a static asset removes the
 * install step from the equation entirely: whatever package manager runs,
 * and whatever it does or doesn't install, these two files ship.
 *
 * `leaflet` and `@types/leaflet` stay in package.json — the `import type`
 * above is erased at build time (never resolved by Rollup), and keeping the
 * dependency is what makes local typechecking real rather than guessed.
 *
 * On a leaflet upgrade: bump package.json, `npm install`, then copy
 * `node_modules/leaflet/dist/leaflet.{js,css}` over these two files.
 */
const LEAFLET_JS_URL = '/vendor/leaflet.js';
const LEAFLET_CSS_URL = '/vendor/leaflet.css';
const LEAFLET_CSS_ID = 'vitalis-leaflet-css';
const LEAFLET_JS_ID = 'vitalis-leaflet-js';

/** Leaflet's dist build is UMD: loading it defines the `L` global. */
type LeafletGlobal = typeof LEAFLET_TYPES;

function ensureLeafletCss(): void {
  if (document.getElementById(LEAFLET_CSS_ID) !== null) return;
  const link = document.createElement('link');
  link.id = LEAFLET_CSS_ID;
  link.rel = 'stylesheet';
  link.href = LEAFLET_CSS_URL;
  document.head.appendChild(link);
}

/**
 * Resolves with the `L` global once the vendored script has run. Concurrent
 * callers share one `<script>` rather than each appending their own — the
 * tag is created once and every later call awaits that same element's load.
 */
function loadLeaflet(): Promise<LeafletGlobal> {
  const existingGlobal = (window as unknown as { L?: LeafletGlobal }).L;
  if (existingGlobal !== undefined) return Promise.resolve(existingGlobal);

  return new Promise((resolve, reject) => {
    const done = () => {
      const L = (window as unknown as { L?: LeafletGlobal }).L;
      if (L === undefined) reject(new Error('leaflet.js loaded but did not define L'));
      else resolve(L);
    };

    const existing = document.getElementById(LEAFLET_JS_ID);
    if (existing !== null) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', () => reject(new Error('leaflet.js failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.id = LEAFLET_JS_ID;
    script.src = LEAFLET_JS_URL;
    script.async = true;
    script.addEventListener('load', done);
    script.addEventListener('error', () => reject(new Error('leaflet.js failed to load')));
    document.head.appendChild(script);
  });
}

export interface HospitalsMapProps {
  readonly origin: { readonly lat: number; readonly lng: number };
  readonly hospitals: readonly NearbyHospital[];
}

export function HospitalsMap({ origin, hospitals }: HospitalsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    let cancelled = false;
    let map: LEAFLET_TYPES.Map | undefined;

    ensureLeafletCss();
    void loadLeaflet().then((L) => {
      if (cancelled) return;

      map = L.map(el, {
        // A hospital list is a decision aid, not an exploration tool — no
        // scroll-wheel zoom fighting the page's own scroll, and dragging
        // stays on so a cluster of nearby results can still be spread apart.
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const originIcon = L.divIcon({
        className: 'hospital-map-pin hospital-map-pin-origin',
        iconSize: [16, 16],
        html: '<span></span>',
      });
      const hospitalIcon = L.divIcon({
        className: 'hospital-map-pin hospital-map-pin-hospital',
        iconSize: [14, 14],
        html: '<span></span>',
      });

      const bounds = L.latLngBounds([[origin.lat, origin.lng]]);
      L.marker([origin.lat, origin.lng], { icon: originIcon }).addTo(map).bindPopup('You are here');

      for (const hospital of hospitals) {
        const point: [number, number] = [hospital.location.lat, hospital.location.lng];
        bounds.extend(point);
        const popup = [hospital.name, hospital.address, `${hospital.distanceKm.toFixed(1)} km away`]
          .filter((line) => line !== undefined && line.length > 0)
          .map((line) => escapeHtml(line as string))
          .join('<br/>');
        L.marker(point, { icon: hospitalIcon }).addTo(map).bindPopup(popup);
      }

      // Fits every pin (patient + every hospital) in view, rather than
      // guessing a zoom level — correct whether results are 500m apart or
      // spread across a whole city.
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
    }).catch((err: unknown) => {
      // The map is an enhancement over the hospital list, not the list
      // itself — if the library can't load, the names, addresses, distances,
      // Call and Directions buttons underneath are all still there and still
      // correct. Logged, not surfaced: there is nothing the user could do
      // about it, and an error card here would imply the results are
      // unreliable when they aren't.
      console.warn('[hospitals-map] leaflet unavailable, showing list only:', err);
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
    // `hospitals` is a fresh array each search, which is the correct trigger
    // to rebuild the map — a stale set of pins from the previous search
    // would be worse than the brief flash of a rebuild.
  }, [origin.lat, origin.lng, hospitals]);

  return <div ref={containerRef} className="hospitals-map" aria-label="Map of nearby hospitals" />;
}

/** The only untrusted strings reaching Leaflet's HTML popups are OSM's own
 * name/address fields — real survey data, but still third-party text, so it
 * is escaped before going into `bindPopup`'s HTML rather than trusted raw. */
function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
