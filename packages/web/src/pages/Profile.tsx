import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BiologicalSex } from '@triage/shared';
import { useProfile } from '../data/profileStore';

/**
 * Local, on-device profile — same glass card language as the rest of the
 * app, no new visual system. Deliberately NOT an authenticated account:
 * there is no login anywhere in VITALIS web, so this page says so plainly
 * rather than implying a server holds this data. If real authentication is
 * added later, this is the one place that would need a "synced to your
 * account" state added — the shape (name/age/sex/blood group/allergies)
 * would not need to change.
 */
export function Profile() {
  const { profile, save } = useProfile();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [ageYears, setAgeYears] = useState(profile.ageYears > 0 ? String(profile.ageYears) : '');
  const [sex, setSex] = useState<BiologicalSex>(profile.sex);
  const [bloodGroup, setBloodGroup] = useState(profile.bloodGroup);
  const [allergies, setAllergies] = useState(profile.allergies);
  const [saved, setSaved] = useState(false);

  const submit = () => {
    save({ displayName: displayName.trim(), ageYears: Number(ageYears) || 0, sex, bloodGroup: bloodGroup.trim(), allergies: allergies.trim() });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="page fade-up">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 className="h1">Profile</h1>
        <Link to="/settings" className="foot" style={{ textDecoration: 'none' }}>
          ← Settings
        </Link>
      </div>

      <div className="glass card">
        <div className="label" style={{ color: 'var(--warn-deep)' }}>
          Local device data
        </div>
        <p className="small" style={{ marginTop: 6 }}>
          This profile is stored only in this browser (localStorage) and is never sent anywhere unless you start an
          Emergency case — there is no sign-in and no server account in this app yet.
        </p>
      </div>

      <div className="glass card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div className="label">NAME</div>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="text-input" style={{ width: '100%', marginTop: 4 }} placeholder="Your name" />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="label">AGE</div>
            <input value={ageYears} onChange={(e) => setAgeYears(e.target.value)} type="number" min={0} max={130} className="text-input" style={{ width: '100%', marginTop: 4 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">SEX</div>
            <div className="row" style={{ marginTop: 4, gap: 6 }}>
              {(['female', 'male'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSex(option)}
                  className="btn"
                  style={{ flex: 1, padding: '9px 8px', fontSize: 12.5, textTransform: 'capitalize', background: sex === option ? 'var(--primary)' : 'rgba(255,255,255,0.6)', color: sex === option ? '#fff' : 'var(--ink)', border: '1px solid var(--hairline)' }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="label">BLOOD GROUP</div>
          <input value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value.toUpperCase())} className="text-input" style={{ width: '100%', marginTop: 4 }} placeholder="e.g. O+" />
        </div>
        <div>
          <div className="label">ALLERGIES</div>
          <input value={allergies} onChange={(e) => setAllergies(e.target.value)} className="text-input" style={{ width: '100%', marginTop: 4 }} placeholder="e.g. Penicillin, peanuts" />
        </div>
        <button className="btn btn-primary" onClick={submit}>
          {saved ? 'Saved' : 'Save profile'}
        </button>
      </div>

      {profile.updatedAt !== undefined ? <p className="foot">Last updated {new Date(profile.updatedAt).toLocaleString()}</p> : null}
    </div>
  );
}
