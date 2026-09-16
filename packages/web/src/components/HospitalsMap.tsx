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

const LEAFLET_CSS_ID = 'vitalis-leaflet-css';

/**
 * A COMMITTED, VENDORED COPY of `node_modules/leaflet/dist/leaflet.css`
 * (leaflet@1.9.4), at `public/vendor/leaflet.css` — a plain static file
 * Vite serves as-is, not a package import.
 *
 * This used to be `import leafletCssUrl from 'leaflet/dist/leaflet.css?url'`
 * (Vite's asset-URL suffix, which resolves a package file's built URL
 * without inlining it — the same "cost only when this component actually
 * mounts" property the dynamic JS import below has). It built cleanly here,
 * but failed on Render: `Rollup failed to resolve import
 * "leaflet/dist/leaflet.css?url"`, because Render's build runs through
 * `yarn` against an npm-workspaces monorepo (package-lock.json, no
 * yarn.lock) — the two installers do not necessarily lay out a scoped
 * workspace's `node_modules` identically, and Rollup's resolver only needs
 * to miss the file once for the whole build to fail. A static public/ file
 * has no package resolution step at all, so there is nothing left for that
 * mismatch to break — whatever installer ran, this file is just HTTP-served
 * from where Vite already knows to find it.
 *
 * Reproducing this on a leaflet upgrade: copy the new
 * `node_modules/leaflet/dist/leaflet.css` over this file.
 */
const LEAFLET_CSS_URL = '/vendor/leaflet.css';

function ensureLeafletCss(): void {
  if (document.getElementById(LEAFLET_CSS_ID) !== null) return;
  const link = document.createElement('link');
  link.id = LEAFLET_CSS_ID;
  link.rel = 'stylesheet';
  link.href = LEAFLET_CSS_URL;
  document.head.appendChild(link);
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
    void import('leaflet').then((LeafletModule) => {
      if (cancelled) return;
      const L = LeafletModule.default ?? LeafletModule;

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
