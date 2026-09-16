import { useState } from 'react';
import { PHONE_E164_PATTERN, useContacts } from '../data/contactsStore';
import { AddPill } from './VitalsPanel';

/**
 * Who Emergency's confirm gets sent to.
 *
 * Lives in Settings, not behind Google sign-in (Profile.tsx's form is —
 * this app has no accounts requirement, and gating the one control that
 * makes Twilio notifications possible behind an optional sign-in would
 * reintroduce the same gap this panel exists to close for everyone else).
 */
export function EmergencyContactsPanel() {
  const { contacts, add, remove, atLimit } = useContacts();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [canRelay, setCanRelay] = useState(false);
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);

  const reset = () => {
    setName('');
    setRelationship('');
    setPhone('');
    setWhatsappEnabled(true);
    setSmsEnabled(false);
    setCanRelay(false);
    setPhoneError(undefined);
    setAdding(false);
  };

  const submit = () => {
    if (name.trim().length === 0) return;
    if (!PHONE_E164_PATTERN.test(phone.trim())) {
      setPhoneError('Use international format, e.g. +919876543210 (country code, no spaces or dashes).');
      return;
    }
    add({
      name: name.trim(),
      relationship: relationship.trim() || 'other',
      phoneE164: phone.trim(),
      whatsappEnabled,
      smsEnabled,
      canRelay,
    });
    reset();
  };

  return (
    <div className="glass card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="label">Emergency contacts</div>
        {contacts.length > 0 && !adding && !atLimit ? (
          <button onClick={() => setAdding(true)} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
            Add
          </button>
        ) : null}
      </div>
      <p className="small" style={{ marginTop: 6, marginBottom: 12 }}>
        Notified by WhatsApp or SMS when you confirm an emergency (press-and-hold). Stored only on this device — there
        is no server-side contacts list.
      </p>

      {adding ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ flex: 1.3 }}>
              <div className="label">NAME</div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amma" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="label">RELATIONSHIP</div>
              <input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Mother" style={inputStyle} />
            </div>
          </div>
          <div>
            <div className="label">PHONE (WITH COUNTRY CODE)</div>
            <input
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneError(undefined);
              }}
              placeholder="+919876543210"
              style={inputStyle}
            />
            {phoneError !== undefined ? <p className="foot" style={{ marginTop: 4, color: 'var(--danger-deep)' }}>{phoneError}</p> : null}
          </div>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <Checkbox label="WhatsApp" checked={whatsappEnabled} onChange={setWhatsappEnabled} />
            <Checkbox label="SMS" checked={smsEnabled} onChange={setSmsEnabled} />
            <Checkbox label="Can accept a relay" checked={canRelay} onChange={setCanRelay} />
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={reset}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={name.trim().length === 0 || phone.trim().length === 0}>
              Add
            </button>
          </div>
        </div>
      ) : contacts.length === 0 ? (
        <AddPill onClick={() => setAdding(true)} label="Add an emergency contact" />
      ) : (
        <>
          <div>
            {contacts.map((c, i) => (
              <div key={c.id} className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderTop: i > 0 ? '1px solid var(--divider)' : undefined }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                    {c.name}
                    {c.relationship !== 'other' ? <span className="foot"> · {c.relationship}</span> : null}
                  </div>
                  <div className="small" style={{ marginTop: 2 }}>
                    {c.phoneE164} · {[c.whatsappEnabled ? 'WhatsApp' : undefined, c.smsEnabled ? 'SMS' : undefined].filter(Boolean).join(', ') || 'no channel enabled'}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`Remove "${c.name}" from emergency contacts?`)) remove(c.id);
                  }}
                  aria-label={`Remove ${c.name}`}
                  style={{ marginLeft: 10, width: 26, height: 26, borderRadius: 13, border: 'none', background: 'rgba(220,38,38,0.1)', color: 'var(--danger-deep)', fontSize: 14, lineHeight: 1, cursor: 'pointer', flex: 'none' }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {atLimit ? (
            <p className="foot" style={{ marginTop: 8 }}>Up to 10 contacts — remove one to add another.</p>
          ) : (
            <div style={{ marginTop: 10 }}>
              <AddPill onClick={() => setAdding(true)} label="Add another contact" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 15, height: 15 }} />
      {label}
    </label>
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
