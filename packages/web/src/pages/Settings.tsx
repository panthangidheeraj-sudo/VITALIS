import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { getPermission, isEnabled, notificationsSupported, requestPermission, setEnabled } from '../data/notifications';
import { useLanguage, type LanguageCode } from '../data/languageStore';
import { useTranslation } from '../data/translations';

/**
 * Every row here either genuinely works or is explicitly marked as not
 * available — per instruction, no decorative switches. Reduced-motion is
 * read-only here on purpose: it's an OS/browser-level preference
 * (`prefers-reduced-motion`), and VITALIS already respects it everywhere
 * (see theme.css) — there is nothing for an in-app toggle to control that
 * the OS setting doesn't already control more correctly.
 */
export function Settings() {
  const [reachable, setReachable] = useState<boolean | undefined>(undefined);
  const [scorer, setScorer] = useState<string | undefined>(undefined);
  const [notifPermission, setNotifPermission] = useState(getPermission());
  const [notifEnabled, setNotifEnabled] = useState(isEnabled());
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (cancelled) return;
        setReachable(true);
        setScorer(h.clinicalScorer);
      })
      .catch(() => {
        if (!cancelled) setReachable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleNotifications = async () => {
    if (!notifEnabled) {
      // Permission is requested here, from this click — never on page load.
      const result = await requestPermission();
      setNotifPermission(result);
      if (result === 'granted') {
        setEnabled(true);
        setNotifEnabled(true);
      }
    } else {
      setEnabled(false);
      setNotifEnabled(false);
    }
  };

  const clearLocalData = () => {
    if (!window.confirm('Remove all vitals, medications and profile data stored on this device? This cannot be undone.')) return;
    for (const key of [
      'vitalis.vitals.v1',
      'vitalis.medications.v1',
      'vitalis.profile.v1',
      'vitalis.chatSessions.v1',
      'vitalis.chatActiveSession.v1',
      'vitalis.language.v1',
    ]) {
      localStorage.removeItem(key);
    }
    window.location.reload();
  };

  const languages: { code: LanguageCode; label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिंदी (Hindi)' },
    { code: 'te', label: 'తెలుగు (Telugu)' },
  ];

  return (
    <div className="page fade-up">
      <h1 className="h1">{t('settings.title')}</h1>

      <Row to="/profile" title={t('settings.profile')} sub="Name, age, sex, blood group, allergies" />
      <Row to="/settings/version" title="Version history" sub="What's changed" />

      <div className="glass card">
        <div className="label">{t('settings.language')}</div>
        <p className="small" style={{ marginTop: 6, marginBottom: 12 }}>
          Changes the interface language globally across VITALIS.
        </p>
        <div className="row" style={{ gap: 8 }}>
          {languages.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l.code)}
              className="btn"
              style={{
                flex: 1,
                padding: '10px 8px',
                fontSize: 13,
                background: language === l.code ? 'var(--primary)' : 'rgba(255,255,255,0.6)',
                color: language === l.code ? '#fff' : 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="glass card">
        <div className="label">Backend connection</div>
        <p className="small" style={{ marginTop: 6 }}>
          {reachable === undefined ? 'Checking…' : reachable ? `Connected — clinical scoring: ${scorer?.replace(/_/g, ' ') ?? 'unknown'}` : `Unreachable at ${api.baseUrl}`}
        </p>
      </div>

      <div className="glass card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="label">{t('settings.notifications')}</div>
            <p className="small" style={{ marginTop: 6, maxWidth: 220 }}>
              {notificationsSupported()
                ? 'Only fires while VITALIS is open in this browser tab — there is no push/closed-tab delivery.'
                : 'Not supported in this browser.'}
            </p>
          </div>
          {notificationsSupported() ? (
            <button className="btn" onClick={() => void toggleNotifications()} style={{ padding: '9px 14px', fontSize: 12.5, background: notifEnabled ? 'var(--ok)' : 'var(--primary)', color: '#fff' }}>
              {notifEnabled ? 'On' : notifPermission === 'denied' ? 'Blocked' : 'Turn on'}
            </button>
          ) : null}
        </div>
        {notifPermission === 'denied' ? (
          <p className="foot" style={{ marginTop: 8, color: 'var(--danger-deep)' }}>
            Notifications are blocked at the browser level. Re-enable them in your browser's site settings for this page.
          </p>
        ) : null}
      </div>

      <div className="glass card">
        <div className="label">{t('settings.motion')}</div>
        <p className="small" style={{ marginTop: 6 }}>
          Reduced motion is {reducedMotion ? 'ON' : 'OFF'} — set in your OS/browser, not in VITALIS. Animations already follow it everywhere in this app.
        </p>
      </div>

      <div className="glass card">
        <div className="label" style={{ color: 'var(--danger-deep)' }}>
          {t('settings.localData')}
        </div>
        <p className="small" style={{ marginTop: 6, marginBottom: 10 }}>
          Vitals, medications and your profile live only in this browser. Clearing them cannot be undone.
        </p>
        <button className="btn btn-danger-outline" onClick={clearLocalData}>
          Clear local data
        </button>
      </div>
    </div>
  );
}

function Row({ to, title, sub }: { readonly to: string; readonly title: string; readonly sub: string }) {
  return (
    <Link to={to} className="glass card row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
      <div>
        <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{title}</div>
        <div className="small" style={{ marginTop: 2 }}>{sub}</div>
      </div>
      <span style={{ color: 'var(--muted)' }}>›</span>
    </Link>
  );
}
