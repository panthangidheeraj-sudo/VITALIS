import { useEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Nav } from './components/Nav';
import { Home } from './pages/Home';
import { Assistant } from './pages/Assistant';
import { Emergency } from './pages/Emergency';
import { FirstAid } from './pages/FirstAid';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { VersionHistory } from './pages/VersionHistory';
import { Medicine } from './pages/Medicine';
import { useMedications } from './data/medicationStore';
import { checkDueReminders } from './data/notifications';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';

/** Mounted once at the app root (not per-page) so a medication notification
 * can fire regardless of which screen is currently open — see
 * data/notifications.ts for exactly what this is and is not capable of. */
function ReminderWatcher() {
  const { reminders } = useMedications();
  useEffect(() => {
    checkDueReminders(reminders);
    const id = window.setInterval(() => checkDueReminders(reminders), 30_000);
    return () => window.clearInterval(id);
  }, [reminders]);
  return null;
}

/** Nav-tab rank, used only to pick a transition DIRECTION (item 1: "the
 * transition should feel like moving through a single glass space," not a
 * random crossfade). Sub-pages with no tab of their own (Profile, Settings,
 * Medicine, version history) rank as "one step deeper than Home" — opening
 * one enters from the right, returning to Home exits back to the left,
 * which matches how the gear icon/tiles that lead to them are laid out. */
const RANK: Record<string, number> = { '/': 0, '/assistant': 1, '/emergency': 2, '/first-aid': 3 };
function rankOf(pathname: string): number {
  return RANK[pathname] ?? 0.5;
}

/** Directional glass page transition (item 1). Deliberately entrance-only —
 * see theme.css's `.route-view` comment for why a dual-rendered exit pane
 * was scoped out. `key={pathname}` is what makes the CSS animation replay on
 * every navigation; the background atmosphere (`.bg-glow`, the body wash)
 * lives in the PARENT of this component, so it is never touched by it. */
function RouteTransition({ children }: { readonly children: React.ReactNode }) {
  const location = useLocation();
  const prevRank = useRef(rankOf(location.pathname));
  const currentRank = rankOf(location.pathname);
  const dir = currentRank >= prevRank.current ? 'fwd' : 'back';
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    prevRank.current = currentRank;
  }, [currentRank]);

  return (
    <div className="route-view">
      {/* `route-pane` is applied ALWAYS — it carries the flex sizing that lets
          the page fill the screen. Only `data-dir`, which the entrance
          animation keys off, is withheld under reduced motion. */}
      <div key={location.pathname} className="route-pane" {...(reducedMotion ? {} : { 'data-dir': dir })}>
        {children}
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      {/* One slow, cheap ambient glow behind everything — see theme.css's
          .bg-glow: transform+opacity only, a single element, GPU-composited.
          Sitting outside RouteTransition/Routes, it is never remounted by a
          route change — the thing item 14F ("background continuity") and
          the route-transition's own header comment both depend on. */}
      <div className="bg-glow" />
      <ReminderWatcher />
      <div className="app-shell" style={{ position: 'relative', zIndex: 1 }}>
        <RouteTransition>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/emergency" element={<Emergency />} />
            <Route path="/first-aid" element={<FirstAid />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/version" element={<VersionHistory />} />
            <Route path="/medicine" element={<Medicine />} />
            {/* Unknown routes fall back to Home rather than a blank/broken
                page — the server's SPA fallback already guarantees any path
                reaches this router; this is what happens once it does. */}
            <Route path="*" element={<Home />} />
          </Routes>
        </RouteTransition>
        <Nav />
      </div>
    </BrowserRouter>
  );
}
