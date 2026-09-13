import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useMedications } from '../data/medicationStore';

export function Home() {
  const [reachable, setReachable] = useState<boolean | undefined>(undefined);
  const [scorer, setScorer] = useState<string | undefined>(undefined);
  const { reminders, add, toggleTaken } = useMedications();
  const [medName, setMedName] = useState('');
  const [medTime, setMedTime] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((health) => {
        if (cancelled) return;
        setReachable(true);
        setScorer(health.clinicalScorer);
      })
      .catch(() => {
        if (!cancelled) setReachable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <div className="label" style={{ marginBottom: -6 }}>
        {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
      <h1 className="serif-display fade-up">Hello.</h1>

      {reachable === false ? (
        <div className="glass card" style={{ borderLeft: '4px solid var(--danger)', background: 'var(--danger-wash)' }}>
          <div className="h3" style={{ color: 'var(--danger-deep)' }}>
            Orchestrator unreachable
          </div>
          <p className="small" style={{ marginTop: 4 }}>
            The backend at <code>{api.baseUrl}</code> did not respond. Check VITE_API_URL. First aid below still works.
          </p>
        </div>
      ) : (
        <div className="row glass card" style={{ padding: '12px 16px' }}>
          <span className={`dot${reachable === true ? ' dot-pulse' : ''}`} style={{ background: reachable === undefined ? 'var(--faint)' : 'var(--ok)' }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: reachable === undefined ? 'var(--slate)' : 'var(--ok)' }}>
            {reachable === undefined ? 'Checking…' : 'Connected'}
          </span>
          {scorer !== undefined ? <span className="foot" style={{ marginLeft: 'auto' }}>Scoring: {scorer.replace(/_/g, ' ')}</span> : null}
        </div>
      )}

      <Link to="/emergency" className="btn btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }}>
        Start emergency triage
      </Link>

      <section className="glass card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 className="h3">Medication reminders</h3>
        </div>
        {reminders.length === 0 ? (
          <p className="small">No reminders yet — add one below.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reminders.map((r) => (
              <button
                key={r.id}
                onClick={() => toggleTaken(r.id)}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  border: 'none',
                  background: 'transparent',
                  padding: '8px 0',
                  borderTop: '1px solid var(--divider)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                  <div className="small">{r.at}</div>
                </div>
                <span className="foot" style={{ color: r.takenToday ? 'var(--ok)' : 'var(--warn)', fontWeight: 700 }}>
                  {r.takenToday ? 'TAKEN' : 'DUE'}
                </span>
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (medName.trim().length === 0 || medTime.trim().length === 0) return;
            add(medName, medTime);
            setMedName('');
            setMedTime('');
          }}
          className="row"
          style={{ marginTop: 10, gap: 8 }}
        >
          <input
            value={medName}
            onChange={(e) => setMedName(e.target.value)}
            placeholder="Metformin 500mg"
            style={{ flex: 1.4, minWidth: 0 }}
            className="text-input"
          />
          <input
            value={medTime}
            onChange={(e) => setMedTime(e.target.value)}
            placeholder="8:00 AM"
            style={{ flex: 1, minWidth: 0 }}
            className="text-input"
          />
          <button type="submit" className="btn btn-secondary" style={{ padding: '10px 14px' }}>
            Add
          </button>
        </form>
      </section>

      <div className="grid-2">
        <Link to="/first-aid" className="glass card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="label">First aid</div>
          <div className="h3" style={{ marginTop: 6 }}>
            Works offline
          </div>
        </Link>
        <Link to="/emergency" className="glass card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="label">Nearby hospitals</div>
          <div className="h3" style={{ marginTop: 6 }}>
            Inside Emergency
          </div>
        </Link>
      </div>

      <p className="foot" style={{ textAlign: 'center', marginTop: 8 }}>
        Decision support in a simulated environment. Not a medical device. Never diagnoses or prescribes.
      </p>
    </div>
  );
}
