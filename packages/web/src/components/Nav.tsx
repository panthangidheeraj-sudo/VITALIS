import { NavLink } from 'react-router-dom';
import { NavGlyph } from './icons';

const ITEMS = [
  { to: '/', id: 'home', label: 'Home', end: true },
  { to: '/assistant', id: 'assistant', label: 'Assistant', end: false },
  { to: '/emergency', id: 'emergency', label: 'Emergency', end: false },
  { to: '/first-aid', id: 'firstaid', label: 'First Aid', end: false },
] as const;

/** The floating glass tab bar, ported from
 * packages/mobile/src/ui/Chrome.tsx's `BottomNav` — same four destinations,
 * same icons, same "selected item gets a blue translucent capsule" treatment. */
export function Nav() {
  return (
    <div className="nav-wrap">
      <nav className="nav-bar">
        {ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            {({ isActive }) => (
              <>
                <NavGlyph id={item.id} tint={isActive ? '#1769E8' : '#93A9CE'} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
