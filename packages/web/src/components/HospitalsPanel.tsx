import { useState } from 'react';
import { api, ApiError, type NearbyHospital } from '../api/client';
import { EMERGENCY_NUMBER } from '../data/firstAidContent';
import { HospitalsMap } from './HospitalsMap';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  // `origin` is kept alongside the results, not discarded after the fetch —
  // it's what HospitalsMap plots the patient's own position from, and the
  // ONLY other option would be re-reading `navigator.geolocation` a second
  // time just to draw the map, asking for the same permission prompt twice
  // for one search.
  | { readonly kind: 'done'; readonly hospitals: readonly NearbyHospital[]; readonly origin: { readonly lat: number; readonly lng: number } }
  | { readonly kind: 'unavailable'; readonly message: string };

/** Browser port of packages/mobile/src/components/HospitalsPanel.tsx — same
 * `GET /hospitals/nearby` call. Everything shown is real OpenStreetMap data;
 * a field OSM does not carry is simply not rendered. Uses the browser
 * Geolocation API instead of expo-location, and requires an explicit tap
 * before requesting location. */
export function HospitalsPanel() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const fetchHospitals = () => {
    if (!('geolocation' in navigator)) {
      setStatus({ kind: 'unavailable', message: 'This browser does not support location.' });
      return;
    }
    setStatus({ kind: 'loading' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const origin = { lat: position.coords.latitude, lng: position.coords.longitude };
        api
          .nearbyHospitals(origin.lat, origin.lng)
          .then((result) => setStatus({ kind: 'done', hospitals: result.hospitals, origin }))
          .catch((err) => {
            // NEVER render the raw error. An upstream failure here used to
            // print "https://overpass-api.de/api/interpreter: fetch failed"
            // into the Emergency screen. The server already replaces its own
            // diagnostics with a user-facing sentence, but a transport
            // failure between browser and server (offline, CORS, 502 HTML
            // from a proxy) would still surface an internal string, so this
            // side never trusts the message either.
            if (err instanceof ApiError) console.warn(`[hospitals] ${err.code}: ${err.message}`);
            setStatus({
              kind: 'unavailable',
              message: 'Nearby hospitals are temporarily unavailable. Please try again.',
            });
          });
      },
      (error) => {
        setStatus({ kind: 'unavailable', message: error.code === 1 ? 'Location permission was denied.' : 'Location permission was not granted or failed.' });
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  if (status.kind === 'idle') {
    return (
      <div className="glass card fade-up">
        <div className="label">Nearby hospitals</div>
        <p className="small" style={{ marginTop: 8, marginBottom: 12 }}>
          Find nearby emergency centers and hospitals. VITALIS will need permission to access your location.
        </p>
        <button className="btn btn-secondary" onClick={fetchHospitals} style={{ width: '100%' }}>
          Find Nearby Hospitals
        </button>
      </div>
    );
  }

  if (status.kind === 'loading') {
    return (
      <div className="glass card fade-up">
        <div className="label">Nearby hospitals</div>
        <div className="row" style={{ marginTop: 12, gap: 12, padding: 8 }}>
          <span className="glass-loading" style={{ color: 'var(--primary)' }}>
            <span className="dot-beat" />
            <span className="dot-beat" />
            <span className="dot-beat" />
          </span>
          <span className="small">Finding hospitals near you...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="glass card fade-up">
      <div className="label">Nearby hospitals</div>
      {status.kind === 'unavailable' ? (
        <div style={{ marginTop: 8 }}>
          <p className="small">{status.message}</p>
          <button className="btn btn-secondary" onClick={fetchHospitals} style={{ marginTop: 12, width: '100%' }}>
            Try again
          </button>
          <p className="foot" style={{ marginTop: 10 }}>
            In an emergency, call {EMERGENCY_NUMBER} — they will route you without this list.
          </p>
        </div>
      ) : status.hospitals.length === 0 ? (
        <div style={{ marginTop: 8 }}>
          <p className="small">
            No hospitals found nearby.
          </p>
          <button className="btn btn-secondary" onClick={fetchHospitals} style={{ marginTop: 12, width: '100%' }}>
            Search Again
          </button>
        </div>
      ) : (
        <>
        <HospitalsMap origin={status.origin} hospitals={status.hospitals} />
        {status.hospitals.map((hospital, i) => (
          <div
            key={hospital.osmId}
            className="row"
            style={{
              justifyContent: 'space-between',
              paddingTop: 12,
              marginTop: i > 0 ? 12 : 8,
              borderTop: i > 0 ? '1px solid var(--divider)' : undefined,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{hospital.name}</div>
              {hospital.address !== undefined ? <div className="small">{hospital.address}</div> : null}
              {typeof hospital.distanceKm === 'number' ? (
                <div className="foot" style={{ marginTop: 2 }}>{hospital.distanceKm.toFixed(1)} km away</div>
              ) : null}
            </div>
            <div className="row" style={{ gap: 6, flex: 'none' }}>
              {hospital.phone !== undefined ? (
                <a className="btn btn-primary" style={{ padding: '8px 12px', fontSize: 12, textDecoration: 'none', color: '#fff' }} href={`tel:${hospital.phone}`}>
                  Call
                </a>
              ) : null}
              {/* Coordinates are real, so directions are too — this opens the
                  user's own map app rather than asserting anything itself. */}
              <a
                className="btn btn-secondary"
                style={{ padding: '8px 12px', fontSize: 12, textDecoration: 'none' }}
                href={`https://www.openstreetmap.org/directions?to=${hospital.location.lat}%2C${hospital.location.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Directions
              </a>
            </div>
          </div>
        ))}
        </>
      )}
      {status.kind === 'done' && status.hospitals.length > 0 && (
        <p className="foot" style={{ marginTop: 12, textAlign: 'center' }}>
          Names, addresses and locations from OpenStreetMap. Call ahead to confirm details.
        </p>
      )}
    </div>
  );
}

