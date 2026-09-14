/**
 * The ONE "physical glass capsule that travels between items" implementation
 * in the app — shared by the bottom nav (Nav.tsx, travelling between the 4
 * tabs) and First Aid's category pill row (FirstAid.tsx, travelling between
 * topics, including mid-drag). A single measured, absolutely-positioned
 * element behind the items, repositioned via `transform: translateX` rather
 * than swapping each item's own background — see theme.css's
 * `.sliding-capsule` for the spring transition this rides on.
 *
 * `blend` lets a caller interpolate the capsule toward an adjacent item
 * (First Aid's live drag): `t` 0 = fully on `activeKey`, 1 = fully on
 * `blend.toKey`. While `0 < t < 1` the CSS transition is suppressed so the
 * capsule tracks the gesture 1:1, exactly like the card it rides alongside.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

interface Blend {
  readonly toKey: string;
  readonly t: number;
}

export function useSlidingCapsule(containerRef: RefObject<HTMLElement | null>, activeKey: string | undefined, blend?: Blend) {
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });

  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      itemRefs.current[key] = el;
    },
    [],
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (activeKey === undefined || container === null) {
      setStyle((s) => ({ ...s, opacity: 0 }));
      return;
    }
    const fromEl = itemRefs.current[activeKey];
    if (fromEl == null) return;
    const cRect = container.getBoundingClientRect();
    const fRect = fromEl.getBoundingClientRect();
    let x = fRect.left - cRect.left;
    let w = fRect.width;
    // The VERTICAL position is measured too, not assumed. The capsule used to
    // be pinned `top: 0; bottom: 0`, which is only correct while every item
    // sits on one line: once the rail wraps (First Aid's four categories wrap
    // to two rows at 360px) that stretched the capsule across BOTH rows, so
    // the blue pill behind "CPR" also covered "Burns" underneath it.
    let y = fRect.top - cRect.top;
    let h = fRect.height;
    const live = blend !== undefined && blend.t > 0 && blend.t < 1;
    if (blend !== undefined && blend.t > 0) {
      const toEl = itemRefs.current[blend.toKey];
      if (toEl != null) {
        const tRect = toEl.getBoundingClientRect();
        x = x + (tRect.left - cRect.left - x) * blend.t;
        w = w + (tRect.width - w) * blend.t;
        // Interpolated as well, so a drag between items on DIFFERENT rows
        // travels diagonally instead of sliding through the row it is in.
        y = y + (tRect.top - cRect.top - y) * blend.t;
        h = h + (tRect.height - h) * blend.t;
      }
    }
    setStyle({
      transform: `translate(${x}px, ${y}px)`,
      width: w,
      height: h,
      opacity: 1,
      transition: live ? 'none' : undefined,
    });
  }, [activeKey, blend, containerRef]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return { register, style };
}
