import { Link } from 'react-router-dom';
import pkg from '../../package.json';

/**
 * Informational only — not a commit browser. The entries below are a
 * concise, honest summary of the actual work done on this web app
 * (matching the real git history), not generated from any live source, so
 * it never contradicts itself the way a hand-maintained second copy of a
 * changelog easily can. If it drifts from git history in the future,
 * that's this file going stale — there's no live source it's proven
 * against.
 */
const CHANGES: readonly { readonly version: string; readonly summary: string }[] = [
  { version: '0.5', summary: 'Branding (VITALIS logo/favicon), Profile & Settings, medication delete fix, browser notifications, chat history & persistence, camera-based medicine identification.' },
  { version: '0.4', summary: 'Real FloatingLines background (ported from the original design shader), assistant orb entrance animation, one-time count-up on vitals, VITALIS-style loading states.' },
  { version: '0.3', summary: 'Full glassmorphism design port from the original VITALIS mobile redesign: Home, First Aid, floating navigation, blue/white glass system.' },
  { version: '0.2', summary: 'Fixed the production blank-page crash (react/react-dom version mismatch) and deployed the web app to Render.' },
  { version: '0.1', summary: 'Initial web app: Home, Assistant, Emergency, First Aid, Vitals, Medications, Hospitals — wired to the existing backend API.' },
];

export function VersionHistory() {
  return (
    <div className="page fade-up">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 className="h1">Version history</h1>
        <Link to="/settings" className="foot" style={{ textDecoration: 'none' }}>
          ← Settings
        </Link>
      </div>

      <div className="glass card">
        <div className="label">Current version</div>
        <div className="h2" style={{ marginTop: 6 }}>{pkg.version}</div>
        <p className="foot" style={{ marginTop: 6 }}>From packages/web/package.json — the single source, not restated by hand elsewhere.</p>
      </div>

      {CHANGES.map((c) => (
        <div key={c.version} className="glass card">
          <div className="label">v{c.version}</div>
          <p className="body-text" style={{ marginTop: 6 }}>{c.summary}</p>
        </div>
      ))}
    </div>
  );
}
