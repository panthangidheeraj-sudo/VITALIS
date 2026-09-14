import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NavGlyph } from './icons';
import { useSlidingCapsule } from '../hooks/useSlidingCapsule';
import { useTranslation } from '../data/translations';

const ITEMS = [
  { to: '/', id: 'home', tKey: 'nav.home', end: true },
  { to: '/assistant', id: 'assistant', tKey: 'nav.assistant', end: false },
  { to: '/emergency', id: 'emergency', tKey: 'nav.emergency', end: false },
  { to: '/first-aid', id: 'firstaid', tKey: 'nav.firstAid', end: false },
] as const;

function activeIdFor(pathname: string): string | undefined {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/assistant')) return 'assistant';
  if (pathname.startsWith('/emergency')) return 'emergency';
  if (pathname.startsWith('/first-aid')) return 'firstaid';
  return undefined;
}

/** The floating glass tab bar, ported from
 * packages/mobile/src/ui/Chrome.tsx's `BottomNav` — same four destinations,
 * same icons. The selected-tab highlight used to be a per-item background
 * class toggle (an instant swap); it is now one shared `.nav-capsule`
 * element that physically travels to the selected tab — see
 * useSlidingCapsule.ts. */
export function Nav() {
  const location = useLocation();
  const activeId = activeIdFor(location.pathname);
  const railRef = useRef<HTMLElement>(null);
  const { register, style } = useSlidingCapsule(railRef, activeId);
  const { t } = useTranslation();

  return (
    <div className="nav-wrap">
      <nav className="nav-bar capsule-rail" ref={railRef}>
        <div className="sliding-capsule nav-capsule" style={style} aria-hidden="true" />
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            ref={register(item.id)}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <NavGlyph id={item.id} tint={isActive ? '#1769E8' : '#93A9CE'} />
                <span>{t(item.tKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

