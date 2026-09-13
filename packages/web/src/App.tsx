import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
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

export function App() {
  return (
    <BrowserRouter>
      {/* One slow, cheap ambient glow behind everything — see theme.css's
          .bg-glow: transform+opacity only, a single element, GPU-composited. */}
      <div className="bg-glow" />
      <ReminderWatcher />
      <div className="app-shell" style={{ position: 'relative', zIndex: 1 }}>
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
        <Nav />
      </div>
    </BrowserRouter>
  );
}
