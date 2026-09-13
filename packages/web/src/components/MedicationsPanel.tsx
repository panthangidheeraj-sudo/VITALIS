import { useState } from 'react';
import { useMedications } from '../data/medicationStore';
import { BellIcon } from './icons';
import { AddPill } from './VitalsPanel';

/** Ported from packages/mobile/src/components/MedicationsPanel.tsx — same
 * heading/"Add" link pattern, same empty-state "+ Add a reminder" pill,
 * same list-row/bell-watermark treatment. Simplified to daily reminders only
 * (the mobile version's per-date scheduling + week-strip calendar was out
 * of scope for this pass — this is a scoping decision, not a missed port). */
export function MedicationsPanel() {
  const { reminders, add, remove, toggleTaken } = useMedications();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [at, setAt] = useState('');

  const submit = () => {
    add(name, at);
    setName('');
    setAt('');
    setAdding(false);
  };

  return (
    <div className="glass-panel">
      <div style={{ position: 'absolute', right: 12, bottom: 8 }}>
        <BellIcon />
      </div>
      <div className="glass-panel-content">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 className="h3">Medication reminders</h3>
          {reminders.length > 0 && !adding ? (
            <button onClick={() => setAdding(true)} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              Add
            </button>
          ) : null}
        </div>

        {adding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1.4 }}>
                <div className="label">MEDICATION</div>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Metformin 500 mg" style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="label">TIME</div>
                <input value={at} onChange={(e) => setAt(e.target.value)} placeholder="8:00 AM" style={inputStyle} />
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit}>
                Add
              </button>
            </div>
          </div>
        ) : reminders.length === 0 ? (
          <AddPill onClick={() => setAdding(true)} label="Add a reminder" />
        ) : (
          <>
            <div>
              {/*
               * The reminder row used to BE a single <button onClick={toggleTaken}>
               * with no other control anywhere on it or the panel — `remove()`
               * already existed and worked correctly in the store below (it
               * filters the array and persists via the effect on `reminders`),
               * it was simply never wired to anything in this UI. That was the
               * entire "can't delete a reminder" bug: not a storage bug, a
               * missing button. Two separate interactive elements now (HTML
               * doesn't allow a <button> inside a <button>).
               */}
              {reminders.map((r, i) => (
                <div
                  key={r.id}
                  className="row"
                  style={{ justifyContent: 'space-between', padding: '12px 0', borderTop: i > 0 ? '1px solid var(--divider)' : undefined }}
                >
                  <button
                    onClick={() => toggleTaken(r.id)}
                    className="row"
                    style={{ flex: 1, justifyContent: 'space-between', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div>
                      <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{r.name}</div>
                      <div className="small" style={{ marginTop: 2 }}>{r.at}</div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 10, letterSpacing: 0.6, color: r.takenToday ? 'var(--ok)' : 'var(--warn)' }}>
                      {r.takenToday ? 'TAKEN' : 'DUE'}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove "${r.name}"?`)) remove(r.id);
                    }}
                    aria-label={`Remove ${r.name}`}
                    style={{ marginLeft: 10, width: 26, height: 26, borderRadius: 13, border: 'none', background: 'rgba(220,38,38,0.1)', color: 'var(--danger-deep)', fontSize: 14, lineHeight: 1, cursor: 'pointer', flex: 'none' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <p className="foot" style={{ paddingTop: 2 }}>Tap to mark taken · use × to remove</p>
            </div>
            <div style={{ marginTop: 10 }}>
              <AddPill onClick={() => setAdding(true)} label="Add a reminder" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderBottom: '1px solid rgba(15,23,42,0.15)',
  background: 'transparent',
  padding: '8px 0',
  marginTop: 4,
  fontFamily: 'var(--font-sans)',
  fontWeight: 700,
  fontSize: 14,
  color: 'var(--ink)',
};
