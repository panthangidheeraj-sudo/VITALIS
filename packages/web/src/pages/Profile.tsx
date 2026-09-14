import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BiologicalSex } from '@triage/shared';
import { useProfile } from '../data/profileStore';
import { useAuth } from '../data/authStore';

/**
 * Local, on-device profile and Firebase Auth integration.
 * Shows 'Continue with Google' if signed out, and user details if signed in.
 */
export function Profile() {
  const { profile, save } = useProfile();
  const { user, isInitialized, signInWithGoogle, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [ageYears, setAgeYears] = useState(profile.ageYears > 0 ? String(profile.ageYears) : '');
  const [sex, setSex] = useState<BiologicalSex>(profile.sex);
  const [bloodGroup, setBloodGroup] = useState(profile.bloodGroup);
  const [allergies, setAllergies] = useState(profile.allergies);
  const [saved, setSaved] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const submit = () => {
    save({ displayName: displayName.trim(), ageYears: Number(ageYears) || 0, sex, bloodGroup: bloodGroup.trim(), allergies: allergies.trim() });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const handleSignIn = async () => {
    setAuthLoading(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error(e);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="page fade-up">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 className="h1">Profile</h1>
        <Link to="/settings" className="foot" style={{ textDecoration: 'none' }}>
          ← Settings
        </Link>
      </div>

      {!isInitialized ? (
        <div className="glass card">
          <div className="row" style={{ justifyContent: 'center', padding: 20 }}>
            <span className="glass-loading" style={{ color: 'var(--primary)' }}>
              <span className="dot-beat" />
              <span className="dot-beat" />
              <span className="dot-beat" />
            </span>
          </div>
        </div>
      ) : user ? (
        <>
          <div className="glass card">
            <div className="row" style={{ gap: 16 }}>
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" style={{ width: 60, height: 60, borderRadius: 30 }} />
              ) : (
                <div style={{ width: 60, height: 60, borderRadius: 30, background: 'var(--brand)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 'bold' }}>
                  {user.displayName?.[0] || user.email?.[0] || 'U'}
                </div>
              )}
              <div style={{ flex: 1 }}>
                <div className="h2">{user.displayName || 'User'}</div>
                <div className="small" style={{ color: 'var(--muted)', marginTop: 4 }}>{user.email}</div>
              </div>
              <button className="btn btn-secondary" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </div>

          <div className="glass card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="label">VITALIS DATA (LOCAL DEVICE)</div>
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
        </>
      ) : (
        <div className="glass card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '40px 20px' }}>
          <div className="label">SIGN IN TO VITALIS</div>
          <p className="small" style={{ textAlign: 'center', maxWidth: 300 }}>
            Sign in with your Google account to sync your profile across devices.
          </p>
          <button className="btn btn-primary" onClick={handleSignIn} disabled={authLoading} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px' }}>
            {authLoading ? (
              <span className="glass-loading" style={{ color: '#fff' }}>
                <span className="dot-beat" />
                <span className="dot-beat" />
                <span className="dot-beat" />
              </span>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

