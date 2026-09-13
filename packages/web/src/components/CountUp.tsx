/**
 * A one-time count-up reveal for a numeric value — 0 → 32 → 76 → 112, ending
 * exactly at the real stored number. Purely presentational: it never
 * fabricates a reading, never re-triggers on a re-render with the same
 * value (only when `value` itself changes, e.g. the user logs a new
 * reading), and the DOM always ends at the actual number, not an
 * approximation — a screen reader or a "view source" sees the real value
 * the instant the animation would otherwise still be running, because the
 * final `setState` after the last frame sets it exactly to `value`.
 *
 * `prefers-reduced-motion: reduce` skips the animation loop entirely and
 * renders the final value immediately — see the effect below.
 */

import { useEffect, useRef, useState } from 'react';

export function CountUp({ value, durationMs = 700 }: { readonly value: number; readonly durationMs?: number }) {
  const [display, setDisplay] = useState(value);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const from = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out cubic: fast start, settles gently into the real number.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        setDisplay(value); // exact final value, never left at a rounded approximation
      }
    };
    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span className="count-up">{display}</span>;
}
