import { useState } from 'react';
import type { Hospital } from '@triage/shared';
import { api, ApiError } from '../api/client';

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly hospitals: readonly Hospital[] }
  | { readonly kind: 'unavailable'; readonly message: string };

/** Browser port of packages/mobile/src/components/HospitalsPanel.tsx — same
 * `GET /hospitals/nearby` call, same "no photos, real OSM data only, bed
 * counts are simulated" honesty. Uses the browser Geolocation API instead of
 * expo-location. Requires explicit action before requesting location. */
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
        api
          .nearbyHospitals(position.coords.latitude, position.coords.longitude)
          .then((result) => setStatus({ kind: 'done', hospitals: result.hospitals }))
          .catch((err) =>
            setStatus({
              kind: 'unavailable',
              message: err instanceof ApiError ? err.message : 'Could not look up nearby hospitals.',
            }),
          );
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
          <p className="small" style={{ color: 'var(--danger-deep)' }}>
            {status.message}
          </p>
          <button className="btn btn-secondary" onClick={fetchHospitals} style={{ marginTop: 12, width: '100%' }}>
            Retry Location Permission
          </button>
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
        status.hospitals.map((hospital, i) => (
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
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{hospital.name}</div>
              <div className="small">{hospital.address ?? 'Address not mapped'}</div>
              {(hospital as Hospital & { distanceKm?: number }).distanceKm !== undefined ? (
                <div className="foot" style={{ marginTop: 2 }}>{(hospital as Hospital & { distanceKm?: number }).distanceKm!.toFixed(1)} km away</div>
              ) : null}
            </div>
            {hospital.phone !== undefined ? (
              <a className="btn btn-primary" style={{ padding: '8px 12px', fontSize: 12, textDecoration: 'none', color: '#fff' }} href={`tel:${hospital.phone}`}>
                Call
              </a>
            ) : (
              <span className="foot" style={{ padding: '8px 0', fontSize: 11 }}>Phone unavailable</span>
            )}
          </div>
        ))
      )}
      {status.kind === 'done' && status.hospitals.length > 0 && (
        <p className="foot" style={{ marginTop: 12, textAlign: 'center' }}>
          Location and address are real (OpenStreetMap). Specialties and bed counts, where shown, are simulated.
        </p>
      )}
    </div>
  );
}

