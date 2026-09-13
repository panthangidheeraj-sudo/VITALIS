import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { VitalsPanel } from '../components/VitalsPanel';
import { MedicationsPanel } from '../components/MedicationsPanel';
import { PhoneIcon, GearIcon, BandageIcon, BloodDropIcon, ChevronRightSmall } from '../components/icons';

/**
 * Ported from packages/mobile/src/screens/HomeScreen.tsx's uncommitted
 * redesign: the red/blue-glass emergency banner, the vitals/medications
 * glass cards, and the feature-tile grid (icon circle + chevron badge +
 * title + sub) are the SAME components in the SAME arrangement, not a
 * generic recreation. Two differences from the mobile screen, both scoping
 * decisions: no Profile/Medicine-scanner tiles (those pages don't exist in
 * this web build) and a connection-status pill was kept (the mobile
 * redesign dropped it, but it has real diagnostic value on the web where
 * there's no native "orchestrator unreachable" handling elsewhere).
 */
export function Home() {
  const [reachable, setReachable] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then(() => {
        if (!cancelled) setReachable(true);
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
      {reachable === false ? (
        <div className="row glass-panel glass-panel-content fade-up" style={{ padding: '12px 16px', borderLeft: '4px solid var(--red)' }}>
          <span className="dot" style={{ background: 'var(--red)' }} />
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12, color: 'var(--red)' }}>
            Orchestrator unreachable — check VITE_API_URL
          </span>
        </div>
      ) : null}

      {/* Emergency button */}
      <Link to="/emergency" className="fade-up" style={{ textDecoration: 'none', animationDelay: '40ms' }}>
        <div style={emergencyOuterStyle}>
          <div style={emergencyGradientStyle} />
          <div style={emergencyContentStyle}>
            <div style={emergencyIconWrapStyle}>
              <PhoneIcon size={26} />
            </div>
            <span style={{ flex: 1, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 17, color: 'var(--ink)', textAlign: 'center', letterSpacing: -0.3 }}>
              Start emergency
            </span>
            <div style={settingsWrapStyle}>
              <GearIcon size={18} />
            </div>
          </div>
        </div>
      </Link>

      <div className="fade-up" style={{ animationDelay: '100ms' }}>
        <VitalsPanel />
      </div>

      <div className="fade-up" style={{ animationDelay: '160ms' }}>
        <MedicationsPanel />
      </div>

      <div className="grid-2 fade-up" style={{ animationDelay: '220ms' }}>
        <FeatureTile icon={<BloodDropIcon />} iconBg="rgba(255,100,100,0.12)" title="Emergency" sub="Start the triage interview" to="/emergency" />
        <FeatureTile icon={<BandageIcon />} iconBg="rgba(200,175,130,0.18)" title="First aid" sub="Works with no signal" to="/first-aid" />
      </div>

      <p className="foot" style={{ textAlign: 'center', marginTop: 4 }}>
        Decision support in a simulated environment. Not a medical device. Never diagnoses or prescribes.
      </p>
    </div>
  );
}

function FeatureTile({ icon, iconBg, title, sub, to }: { readonly icon: React.ReactNode; readonly iconBg: string; readonly title: string; readonly sub: string; readonly to: string }) {
  return (
    <Link to={to} className="feature-tile">
      <div className="tile-arrow">
        <ChevronRightSmall />
      </div>
      <div className="tile-icon" style={{ background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.6)' }}>
        {icon}
      </div>
      <div className="tile-title">{title}</div>
      <div className="tile-sub">{sub}</div>
    </Link>
  );
}

const emergencyOuterStyle: React.CSSProperties = {
  position: 'relative',
  height: 90,
  borderRadius: 32,
  border: '1px solid rgba(255,255,255,0.9)',
  overflow: 'hidden',
  boxShadow: '0 12px 32px rgba(16,42,84,0.13)',
  backdropFilter: 'blur(40px) saturate(1.6)',
  WebkitBackdropFilter: 'blur(40px) saturate(1.6)',
  background: 'rgba(255,255,255,0.5)',
};

const emergencyGradientStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(90deg, rgba(255,82,82,0.18), rgba(255,255,255,0.08), rgba(190,220,255,0.22))',
};

const emergencyContentStyle: React.CSSProperties = {
  position: 'relative',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  gap: 14,
};

const emergencyIconWrapStyle: React.CSSProperties = {
  width: 58,
  height: 58,
  borderRadius: 29,
  background: 'var(--red)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid rgba(255,255,255,0.5)',
  flex: 'none',
};

const settingsWrapStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 20,
  background: 'rgba(255,255,255,0.4)',
  border: '1px solid rgba(255,255,255,0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
};
