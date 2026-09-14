/**
 * VITALIS startup sequence (item 17). Runs once per browser SESSION —
 * `sessionStorage`, not `localStorage`, so a closed tab gets the full intro
 * again next time but internal navigation never replays it (item 19).
 *
 * Staging is almost entirely CSS-driven (see theme.css's `.intro-*` rules —
 * each element's own `animation-delay` places it on the timeline), which
 * keeps the visual sequence smooth and jank-free. The handful of things CSS
 * cannot do get exactly two JS timers: flipping the status label to "READY"
 * and starting the shrink-into-header handoff, then unmounting once the
 * fade-out finishes. Nothing here uses a JS animation loop.
 *
 * App content renders in full from the very first frame, underneath this
 * overlay at opacity 0 — not mounted afterward — so the real header logo
 * (`#vitalis-header-logo`, see Home.tsx) is already in the DOM and
 * measurable the moment the shrink stage needs its target rect.
 */

import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

const SESSION_KEY = 'vitalis.introShown.v1';
const FULL_SHRINK_AT_MS = 1900;
const FULL_UNMOUNT_AT_MS = FULL_SHRINK_AT_MS + 480;
const BRIEF_UNMOUNT_AT_MS = 360;

type Mode = 'full' | 'brief' | 'none';

function pickMode(reducedMotion: boolean): Mode {
  if (reducedMotion) return 'none';
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1' ? 'brief' : 'full';
  } catch {
    // Private-mode/storage-blocked browsers: fail open to "brief" rather
    // than either crashing or replaying the full sequence on every route.
    return 'brief';
  }
}

export function IntroSplash({ children }: { readonly children: React.ReactNode }) {
  const reducedMotion = usePrefersReducedMotion();
  const [mode] = useState<Mode>(() => pickMode(reducedMotion));
  const [visible, setVisible] = useState(mode !== 'none');
  const [ready, setReady] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  const [shrinkStyle, setShrinkStyle] = useState<React.CSSProperties>({});
  const logoRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (mode === 'none') return;
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // Nothing to do if storage is blocked — worst case the full intro
      // replays next navigation, which is a cosmetic-only downside.
    }

    if (mode === 'brief') {
      const t = window.setTimeout(() => setVisible(false), BRIEF_UNMOUNT_AT_MS);
      return () => window.clearTimeout(t);
    }

    const shrinkTimer = window.setTimeout(() => {
      setReady(true);
      const target = document.getElementById('vitalis-header-logo');
      const source = logoRef.current;
      if (target !== null && source !== null) {
        const t = target.getBoundingClientRect();
        const s = source.getBoundingClientRect();
        // Guard against a zero-size rect (header not laid out yet, or off
        // in an unusual viewport) — a scale of 0 would just vanish the
        // logo instead of shrinking it, so fall back to a plain fade.
        if (t.width > 0 && s.width > 0) {
          const scale = t.width / s.width;
          const dx = t.left + t.width / 2 - (s.left + s.width / 2);
          const dy = t.top + t.height / 2 - (s.top + s.height / 2);
          setShrinkStyle({ transform: `translate(${dx}px, ${dy}px) scale(${scale})` });
        }
      }
      setShrinking(true);
    }, FULL_SHRINK_AT_MS);
    const unmountTimer = window.setTimeout(() => setVisible(false), FULL_UNMOUNT_AT_MS);
    return () => {
      window.clearTimeout(shrinkTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [mode]);

  if (!visible) return <>{children}</>;

  return (
    <>
      <div className={`intro-overlay${mode === 'brief' ? ' intro-brief' : ''}${shrinking ? ' intro-hidden' : ''}`} aria-hidden="true">
        {mode === 'full' ? (
          <div className="intro-rings">
            <span className="intro-ring intro-ring-1" />
            <span className="intro-ring intro-ring-2" />
            <span className="intro-ring intro-ring-3" />
          </div>
        ) : null}
        <div className="intro-logo-wrap">
          <img ref={logoRef} src="/assets/vitalis-logo.svg" width={84} height={84} alt="" className="intro-logo" style={shrinking ? shrinkStyle : undefined} />
          {mode === 'full' ? (
            <svg className="intro-heartbeat" viewBox="0 0 84 84" fill="none" aria-hidden="true">
              <path d="M14 44h11l6-16 10 32 8-24 5 8h16" />
            </svg>
          ) : null}
        </div>
        <div className="intro-wordmark">VITALIS</div>
        {mode === 'full' ? (
          <div className="intro-status">
            <span className={`intro-status-dot${ready ? ' ready' : ''}`} />
            {ready ? 'READY' : 'INITIALIZING VITALIS'}
          </div>
        ) : null}
      </div>
      {/* The app is already fully mounted — this just controls when it
          becomes VISIBLE, so the "logo becomes part of the app" handoff in
          stage 6 is a real crossfade, not a swap between two subtrees. */}
      <div style={{ opacity: shrinking || mode === 'brief' ? 1 : 0, transition: 'opacity 420ms ease' }}>{children}</div>
    </>
  );
}
