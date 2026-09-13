import { NavLink } from 'react-router-dom';

const ITEMS = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/assistant', label: 'Assistant', icon: '＋', end: false },
  { to: '/emergency', label: 'Emergency', icon: '♥', end: false },
  { to: '/first-aid', label: 'First Aid', icon: '⊕', end: false },
] as const;

/** The floating glass tab bar — same four destinations as the mobile app's
 * bottom nav (packages/mobile/src/ui/Chrome.tsx). */
export function Nav() {
  return (
    <div className="nav-wrap">
      <nav className="nav-bar glass">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
