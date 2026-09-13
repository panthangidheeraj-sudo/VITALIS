import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Nav } from './components/Nav';
import { Home } from './pages/Home';
import { Assistant } from './pages/Assistant';
import { Emergency } from './pages/Emergency';
import { FirstAid } from './pages/FirstAid';

export function App() {
  return (
    <BrowserRouter>
      {/* One slow, cheap ambient glow behind everything — see theme.css's
          .bg-glow: transform+opacity only, a single element, GPU-composited. */}
      <div className="bg-glow" />
      <div className="app-shell" style={{ position: 'relative', zIndex: 1 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/emergency" element={<Emergency />} />
          <Route path="/first-aid" element={<FirstAid />} />
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
