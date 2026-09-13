import { useState } from 'react';
import { FIRST_AID_DISCLAIMER, FIRST_AID_TOPICS } from '../data/firstAidContent';
import { GearIcon, PhoneIcon, HeartIcon } from '../components/icons';

const EMERGENCY_NUMBER = '108';

/**
 * Ported from packages/mobile/src/screens/FirstAidScreen.tsx's uncommitted
 * redesign — the offline badge, category pill filters, red/pink glass call
 * banner, and the layered glass card stack (back silhouette layers behind
 * the active topic card) are the SAME visual components, not the plain
 * form-list layout this page used before. One structural difference: the
 * mobile screen's "← Back" link doesn't apply here — First Aid is a
 * top-level nav tab in the web app, not a screen pushed from Home.
 */
export function FirstAid() {
  const [index, setIndex] = useState(0);
  const active = FIRST_AID_TOPICS[index];

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,0.58)', border: '1px solid rgba(255,255,255,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(16,42,84,0.1)' }}>
          <GearIcon />
        </div>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <h1 className="h1">First aid</h1>
        <span className="offline-badge">OFFLINE READY</span>
      </div>
      <p className="body-text" style={{ marginTop: -6 }}>Bundled into the app. No connection is needed to open any of these.</p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {FIRST_AID_TOPICS.map((topic, i) => (
          <button key={topic.id} onClick={() => setIndex(i)} className={`pill${i === index ? ' selected' : ''}`}>
            {topic.title}
          </button>
        ))}
      </div>

      <a href={`tel:${EMERGENCY_NUMBER}`} className="call-banner">
        <div className="call-phone-circle">
          <PhoneIcon />
        </div>
        <div style={{ flex: 'none' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 8.5, color: 'rgba(255,255,255,0.78)', letterSpacing: 1.2 }}>CALL FIRST</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 34, color: '#fff', letterSpacing: -0.5, lineHeight: '38px', marginTop: 1 }}>{EMERGENCY_NUMBER}</div>
        </div>
        <div className="call-divider" />
        <p style={{ flex: 1, fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.4, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
          Call {EMERGENCY_NUMBER} now, or have someone else call while you start.
        </p>
      </a>

      <div className="stack">
        <div className="stack-back" style={{ top: 16, left: '7%', width: '86%', height: 308, background: 'rgba(228,241,255,0.46)', zIndex: 0 }} />
        <div className="stack-back" style={{ top: 8, left: '4%', width: '92%', height: 320, background: 'rgba(222,237,255,0.58)', zIndex: 1 }} />
        {active !== undefined ? (
          <div className="stack-card" style={{ zIndex: 10 }}>
            <div style={{ position: 'absolute', top: 18, right: 18, width: 40, height: 40, borderRadius: 20, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,160,160,0.38)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HeartIcon />
            </div>
            <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 22, color: 'var(--ink)', letterSpacing: -0.3, marginRight: 50 }}>{active.title}</div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45, marginTop: 5 }}>{active.whenToUse}</p>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 190 }}>
              {active.steps.map((step) => (
                <div key={step.n} className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
                  <span className="step-badge">
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11, color: 'var(--primary)' }}>{step.n}</span>
                  </span>
                  <p style={{ flex: 1, fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 13, lineHeight: 1.45, color: 'var(--ink)', margin: 0, paddingTop: 4 }}>{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <p className="foot" style={{ textAlign: 'center' }}>Tap a category above to switch.</p>
      <p className="foot" style={{ textAlign: 'center' }}>{FIRST_AID_DISCLAIMER}</p>
    </div>
  );
}
