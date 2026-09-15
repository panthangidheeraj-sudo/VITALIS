/**
 * Icons ported 1:1 from the mobile app's uncommitted redesign
 * (packages/mobile/src/screens/HomeScreen.tsx, FirstAidScreen.tsx,
 * ui/Chrome.tsx) — same `<Path>` data, react-native-svg's JSX props being
 * already the same camelCase attributes plain SVG uses in JSX, so this is a
 * direct port, not a redraw.
 */

import { Logo } from './Logo';

export function PhoneIcon({ size = 26 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"
        fill="white"
      />
    </svg>
  );
}

export function GearIcon({ size = 18 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="#7185A3" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke="#7185A3"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BandageIcon({ size = 26 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x={3} y={9} width={18} height={6} rx={3} fill="#C8A880" transform="rotate(-30 12 12)" />
      <rect x={3} y={9} width={18} height={6} rx={3} stroke="#B8976A" strokeWidth={1} fill="none" transform="rotate(-30 12 12)" />
      <circle cx={12} cy={12} r={1.5} fill="white" />
    </svg>
  );
}

export function BloodDropIcon({ size = 26 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" fill="#FF5252" stroke="#FF5252" strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}

export function CapsuleIcon({ size = 26 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x={3} y={10} width={18} height={4} rx={2} fill="#F5A623" transform="rotate(-45 12 12)" />
      <path d="M7.76 7.76L16.24 16.24" stroke="white" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M17 7a5 5 0 010 10H7a5 5 0 010-10h10z" stroke="#F5A623" strokeWidth={1.5} fill="none" transform="rotate(-45 12 12)" />
    </svg>
  );
}

export function CameraIcon({ size = 26 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 8a2 2 0 012-2h1.5l1-1.5h7l1 1.5H18a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" stroke="#1769E8" strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={12} cy={12.5} r={3.4} stroke="#1769E8" strokeWidth={1.8} />
    </svg>
  );
}

export function ChevronRightSmall({ size = 12 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 18l6-6-6-6" stroke="#7185A3" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HeartbeatIcon() {
  return (
    <svg width={80} height={50} viewBox="0 0 80 50" fill="none" opacity={0.13}>
      <path d="M0 25h15l8-18 10 36 8-25 6 14h33" stroke="#1769E8" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg width={60} height={60} viewBox="0 0 24 24" fill="none" opacity={0.13}>
      <path
        d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
        stroke="#1769E8"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeartIcon({ size = 20 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
        fill="#FF5252"
        stroke="#FF5252"
        strokeWidth={0.5}
      />
      <path d="M7.5 12h1.8l1-2 1.8 4 1-2H17" stroke="white" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The four bottom-nav glyphs, ported from ui/Chrome.tsx's `NavIcon`. */
/**
 * `active` exists only for the Assistant tab. Every other glyph is a stroked
 * path that takes the selected colour through `tint`; the VITALIS logo is a
 * full-colour mark and recolouring it would be modifying the logo, so it
 * carries its selected state as opacity instead — full when selected,
 * dimmed when not, matching how the other glyphs read at #93A9CE.
 */
export function NavGlyph({ id, tint, active = false }: { readonly id: string; readonly tint: string; readonly active?: boolean }) {
  if (id === 'home') {
    return (
      <svg width={19} height={17} viewBox="0 0 24 22" fill="none">
        <path d="M2 10.5L12 2L22 10.5" stroke={tint} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.5 9V19.5C4.5 20.05 4.95 20.5 5.5 20.5H18.5C19.05 20.5 19.5 20.05 19.5 19.5V9" stroke={tint} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.5 20.5V14.5C9.5 13.95 9.95 13.5 10.5 13.5H13.5C14.05 13.5 14.5 13.95 14.5 14.5V20.5" stroke={tint} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === 'assistant') {
    // The real brand asset, at the same 18px scale as the glyphs either side
    // of it, with its own aspect ratio and corner radius intact — the mark is
    // never stretched, cropped, recoloured or wrapped in another icon.
    return (
      <span style={{ display: 'flex', opacity: active ? 1 : 0.55, transition: 'opacity 180ms ease' }}>
        <Logo size={18} />
      </span>
    );
  }
  if (id === 'emergency') {
    return (
      <svg width={19} height={17} viewBox="0 0 24 21" fill="none">
        <path
          d="M12 20C12 20 2 14.2 2 7.5C2 4.5 4.3 2.5 7 2.5C9 2.5 10.7 3.7 12 5.5C13.3 3.7 15 2.5 17 2.5C19.7 2.5 22 4.5 22 7.5C22 14.2 12 20 12 20Z"
          fill={tint}
        />
        <path d="M6 9.5H9L10.5 6.5L13 12.5L14.5 9.5H18" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <circle cx={12} cy={12} r={10.5} stroke={tint} strokeWidth={2} />
      <path d="M12 7.5V16.5M7.5 12H16.5" stroke={tint} strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}
