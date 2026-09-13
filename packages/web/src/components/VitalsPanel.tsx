import { useState } from 'react';
import { useVitals } from '../data/vitalsStore';
import { HeartbeatIcon } from './icons';
import { CountUp } from './CountUp';

/** Ported from packages/mobile/src/components/VitalsPanel.tsx — same
 * heading/"Log a reading" pattern, same empty-state "+ Add a reading" pill,
 * same tile grid once readings exist, same heartbeat watermark on the
 * glass card behind it. */
export function VitalsPanel() {
  const { vitals, save } = useVitals();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const hasAnyReading = vitals.bpSys !== undefined || vitals.heartRate !== undefined || vitals.spo2 !== undefined || vitals.glucose !== undefined;

  const startEdit = () => {
    setDraft({
      bpSys: vitals.bpSys?.toString() ?? '',
      bpDia: vitals.bpDia?.toString() ?? '',
      heartRate: vitals.heartRate?.toString() ?? '',
      spo2: vitals.spo2?.toString() ?? '',
      glucose: vitals.glucose?.toString() ?? '',
    });
    setEditing(true);
  };

  const submit = () => {
    const num = (key: string): number | undefined => {
      const raw = draft[key]?.trim();
      if (raw === undefined || raw.length === 0) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    save({ bpSys: num('bpSys'), bpDia: num('bpDia'), heartRate: num('heartRate'), spo2: num('spo2'), glucose: num('glucose') });
    setEditing(false);
  };

  return (
    <div className="glass-panel">
      <div style={{ position: 'absolute', right: 16, bottom: 16 }}>
        <HeartbeatIcon />
      </div>
      <div className="glass-panel-content">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 className="h3">Your vitals</h3>
          {!editing ? (
            <button onClick={startEdit} style={pillBtnStyle}>
              {hasAnyReading ? 'Edit' : 'Log a reading'}
            </button>
          ) : null}
        </div>
        <p className="small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
          Enter by you from your own BP cuff, glucometer or oximeter — nothing here is read from a connected device.
        </p>

        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <Field label="BP SYSTOLIC" value={draft.bpSys} onChange={(v) => setDraft((d) => ({ ...d, bpSys: v }))} />
              <Field label="BP DIASTOLIC" value={draft.bpDia} onChange={(v) => setDraft((d) => ({ ...d, bpDia: v }))} />
            </div>
            <div className="row" style={{ gap: 10 }}>
              <Field label="HEART RATE (BPM)" value={draft.heartRate} onChange={(v) => setDraft((d) => ({ ...d, heartRate: v }))} />
              <Field label="SPO₂ (%)" value={draft.spo2} onChange={(v) => setDraft((d) => ({ ...d, spo2: v }))} />
            </div>
            <Field label="BLOOD GLUCOSE (MG/DL)" value={draft.glucose} onChange={(v) => setDraft((d) => ({ ...d, glucose: v }))} />
            <div className="row" style={{ gap: 10, marginTop: 4 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit}>
                Save
              </button>
            </div>
          </div>
        ) : !hasAnyReading ? (
          <AddPill onClick={startEdit} label="Add a reading" />
        ) : (
          <>
            <div className="grid-2" style={{ gap: 10 }}>
              {vitals.bpSys !== undefined ? (
                <Tile index={0} label="BLOOD PRESSURE" value={vitals.bpSys} secondary={vitals.bpDia} unit="mmHg" />
              ) : null}
              {vitals.heartRate !== undefined ? <Tile index={1} label="HEART RATE" value={vitals.heartRate} unit="bpm" /> : null}
              {vitals.spo2 !== undefined ? <Tile index={2} label="SPO₂" value={vitals.spo2} unit="%" /> : null}
              {vitals.glucose !== undefined ? <Tile index={3} label="BLOOD GLUCOSE" value={vitals.glucose} unit="mg/dL" /> : null}
            </div>
            <div style={{ marginTop: 10 }}>
              <AddPill onClick={startEdit} label="Add a reading" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { readonly label: string; readonly value: string | undefined; readonly onChange: (v: string) => void }) {
  return (
    <div style={{ flex: 1 }}>
      <div className="label">{label}</div>
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="—"
        style={{ width: '100%', border: 'none', borderBottom: '1px solid rgba(15,23,42,0.15)', background: 'transparent', padding: '8px 0', marginTop: 4, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}
      />
    </div>
  );
}

/**
 * `index` staggers the label's fade-in slightly ahead of the number
 * (per the brief: "supporting labels should appear slightly earlier"),
 * and the value itself counts up from 0 to the real stored reading once,
 * on mount — see CountUp.tsx. Re-keyed by the panel above whenever the
 * underlying reading changes, so a genuinely new reading re-triggers the
 * reveal; re-rendering for an unrelated reason (e.g. editing a different
 * field) does not.
 */
function Tile({ index, label, value, secondary, unit }: { readonly index: number; readonly label: string; readonly value: number; readonly secondary?: number; readonly unit: string }) {
  const labelDelay = index * 60;
  const valueDelay = labelDelay + 80;
  return (
    <div className="fade-up" style={{ padding: 12, borderRadius: 14, border: '1px solid rgba(23,105,232,0.12)', background: 'rgba(219,234,254,0.35)', animationDelay: `${labelDelay}ms` }}>
      <div className="label fade-up" style={{ marginBottom: 6, animationDelay: `${labelDelay}ms` }}>
        {label}
      </div>
      <div className="fade-up" style={{ animationDelay: `${valueDelay}ms`, fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 22, color: 'var(--ink)' }}>
        <CountUp value={value} />
        {secondary !== undefined ? (
          <>
            /<CountUp value={secondary} />
          </>
        ) : null}
        <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--muted)' }}>{` ${unit}`}</span>
      </div>
    </div>
  );
}

export function AddPill({ onClick, label }: { readonly onClick: () => void; readonly label: string }) {
  return (
    <button className="add-pill" onClick={onClick}>
      <span className="add-pill-plus">+</span>
      {label}
    </button>
  );
}

const pillBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 999,
  background: 'rgba(23,105,232,0.10)',
  border: '1px solid rgba(23,105,232,0.20)',
  color: 'var(--primary)',
  fontFamily: 'var(--font-sans)',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
};
