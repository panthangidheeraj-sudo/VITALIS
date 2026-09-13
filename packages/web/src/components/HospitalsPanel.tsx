import { useEffect, useState } from 'react';
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
 * expo-location. */
export function HospitalsPanel() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
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
      () => setStatus({ kind: 'unavailable', message: 'Location permission was not granted.' }),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }, []);

  if (status.kind === 'idle' || status.kind === 'loading') return null;

  return (
    <div className="glass card">
      <div className="label">Nearby hospitals</div>
      {status.kind === 'unavailable' ? (
        <p className="small" style={{ marginTop: 8 }}>
          {status.message}
        </p>
      ) : status.hospitals.length === 0 ? (
        <p className="small" style={{ marginTop: 8 }}>
          No hospitals found nearby.
        </p>
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
            </div>
            {hospital.phone !== undefined ? (
              <a className="btn btn-secondary" style={{ padding: '8px 12px', fontSize: 12 }} href={`tel:${hospital.phone}`}>
                Call
              </a>
            ) : null}
          </div>
        ))
      )}
      <p className="foot" style={{ marginTop: 8 }}>
        Location and address are real (OpenStreetMap). Specialties and bed counts, where shown, are simulated.
      </p>
    </div>
  );
}
