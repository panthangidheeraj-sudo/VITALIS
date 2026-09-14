import { useCallback, useRef, useState } from 'react';
import { FIRST_AID_DISCLAIMER, FIRST_AID_TOPICS } from '../data/firstAidContent';
import { GearIcon, PhoneIcon, HeartIcon } from '../components/icons';
import { useSlidingCapsule } from '../hooks/useSlidingCapsule';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

const EMERGENCY_NUMBER = '108';
const COMMIT_MS = 220;

/**
 * Ported from packages/mobile/src/screens/FirstAidScreen.tsx's uncommitted
 * redesign — the offline badge, category pill filters, red/pink glass call
 * banner, and the layered glass card stack are unchanged. What's new in
 * this pass is the motion: the card is a real drag surface (pointer events,
 * 1:1 tracking, spring commit/release), the pill row and the card move
 * together through ONE `goToIndex` function no matter whether the trigger
 * was a swipe, a pill click, or the arrow keys — "one coherent interaction
 * model" per the brief, not three separate implementations that happen to
 * look similar.
 */
export function FirstAid() {
  const topics = FIRST_AID_TOPICS;
  const [index, setIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const reducedMotion = usePrefersReducedMotion();

  const pillRailRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ startX: number; pointerId: number; width: number } | null>(null);
  const committingRef = useRef(false);
  // Mirrors `dragOffset` synchronously so `endDrag` (bound to `pointerup`)
  // never reads a value stale from React's own batching — a fast real
  // swipe can fire several `pointermove` events before React has flushed a
  // re-render, and the release handler must still see the LATEST offset,
  // not whichever render it happened to be attached to.
  const dragOffsetRef = useRef(0);

  const active = topics[index];
  const width = pointerRef.current?.width ?? stackRef.current?.offsetWidth ?? 320;
  const rawProgress = dragOffset / width;
  // Which adjacent pill (if any) the drag is currently leaning toward, and
  // how far — this is what makes the pill capsule travel WITH the card
  // during a live drag instead of jumping only once the drag commits.
  const adjacentIndex = rawProgress < 0 ? index + 1 : rawProgress > 0 ? index - 1 : undefined;
  const blendT = adjacentIndex === undefined || adjacentIndex < 0 || adjacentIndex >= topics.length ? 0 : Math.min(1, Math.abs(rawProgress) * 1.6);

  const { register: registerPill, style: pillCapsuleStyle } = useSlidingCapsule(
    pillRailRef,
    topics[index]?.id,
    adjacentIndex !== undefined && blendT > 0 ? { toKey: topics[adjacentIndex]?.id ?? '', t: blendT } : undefined,
  );

  const goToIndex = useCallback(
    (newIndex: number, direction: 'fwd' | 'back') => {
      if (newIndex < 0 || newIndex >= topics.length || newIndex === index || committingRef.current) return;
      if (reducedMotion) {
        setIndex(newIndex);
        dragOffsetRef.current = 0;
        setDragOffset(0);
        return;
      }
      committingRef.current = true;
      setDir(direction);
      // Spring the CURRENT card the rest of the way off-screen (the CSS
      // transition on `.stack-card`'s transform handles the easing — see
      // the inline style below); the new card mounts fresh, keyed by its
      // own id, and enters via `.stack-card[data-dir]`'s keyframe from the
      // opposite side. Two separate motions, one continuous-looking swap.
      const pushOffset = direction === 'fwd' ? -width * 1.05 : width * 1.05;
      dragOffsetRef.current = pushOffset;
      setDragOffset(pushOffset);
      window.setTimeout(() => {
        setIndex(newIndex);
        dragOffsetRef.current = 0;
        setDragOffset(0);
        committingRef.current = false;
      }, COMMIT_MS);
    },
    [index, reducedMotion, topics.length, width],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || committingRef.current) return;
    // Without this, a mouse-drag that starts over the step text selects it
    // instead of dragging the card — the browser's default text-selection
    // drag and this gesture both want the same mousedown.
    e.preventDefault();
    pointerRef.current = { startX: e.clientX, pointerId: e.pointerId, width: stackRef.current?.offsetWidth ?? 320 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer id the browser doesn't recognise as active (rare, but
      // possible from some synthetic/automated input paths) — the drag
      // still works without capture, it just won't keep tracking if the
      // pointer leaves the element's bounds mid-gesture.
    }
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current === null) return;
    let delta = e.clientX - pointerRef.current.startX;
    // Rubber-band at the ends instead of dragging past the first/last topic.
    if (index === 0 && delta > 0) delta *= 0.35;
    if (index === topics.length - 1 && delta < 0) delta *= 0.35;
    dragOffsetRef.current = delta;
    setDragOffset(delta);
  };

  const endDrag = (commit: boolean) => {
    if (pointerRef.current === null) return;
    const dragWidth = pointerRef.current.width;
    const threshold = dragWidth * 0.22;
    const finalOffset = dragOffsetRef.current;
    pointerRef.current = null;
    setDragging(false);
    if (commit && Math.abs(finalOffset) > threshold) {
      const swipedLeft = finalOffset < 0; // content follows the finger: swiping left reveals the NEXT topic
      const nextIndex = swipedLeft ? index + 1 : index - 1;
      if (nextIndex >= 0 && nextIndex < topics.length) {
        goToIndex(nextIndex, swipedLeft ? 'fwd' : 'back');
        return;
      }
    }
    dragOffsetRef.current = 0;
    setDragOffset(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') goToIndex(index + 1, 'fwd');
    if (e.key === 'ArrowLeft') goToIndex(index - 1, 'back');
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,0.58)', border: '1px solid rgba(255,255,255,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(16,42,84,0.1)' }}>
          <GearIcon />
        </div>
      </div>

      <div className="row fade-up" style={{ gap: 10 }}>
        <h1 className="h1">First aid</h1>
        <span className="offline-badge">OFFLINE READY</span>
      </div>
      <p className="body-text fade-up" style={{ marginTop: -6, animationDelay: '40ms' }}>Bundled into the app. No connection is needed to open any of these.</p>

      <div className="row pill-row capsule-rail fade-up" ref={pillRailRef} style={{ flexWrap: 'wrap', gap: 8, animationDelay: '90ms', position: 'relative' }}>
        <div className="sliding-capsule" style={{ ...pillCapsuleStyle, background: 'var(--primary)', boxShadow: '0 3px 10px rgba(23,105,232,0.28)' }} aria-hidden="true" />
        {topics.map((topic, i) => (
          <button
            key={topic.id}
            ref={registerPill(topic.id)}
            onClick={() => goToIndex(i, i > index ? 'fwd' : 'back')}
            className={`pill${i === index ? ' selected' : ''}`}
            style={{ position: 'relative', zIndex: 1 }}
          >
            {topic.title}
          </button>
        ))}
      </div>

      <a href={`tel:${EMERGENCY_NUMBER}`} className="call-banner fade-up" style={{ animationDelay: '150ms' }}>
        <div className="call-phone-circle">
          <PhoneIcon />
        </div>
        <div style={{ flex: 'none' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 8.5, color: 'rgba(255,255,255,0.78)', letterSpacing: 1.2 }}>CALL FIRST</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 34, color: '#fff', letterSpacing: -0.5, lineHeight: '38px', marginTop: 1 }}>{EMERGENCY_NUMBER}</div>
        </div>
        <div className="call-divider" />
        <p style={{ flex: 1, fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.4, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
          Call {EMERGENCY_NUMBER} now, or have someone else call while you start.
        </p>
      </a>

      <div className="stack fade-up" ref={stackRef} style={{ animationDelay: '210ms' }} tabIndex={0} onKeyDown={onKeyDown} aria-label="First aid topic, use arrow keys or swipe to switch">
        <div className="stack-back" style={{ top: 16, left: '7%', width: '86%', height: 308, background: 'rgba(228,241,255,0.46)', zIndex: 0 }} />
        <div className="stack-back" style={{ top: 8, left: '4%', width: '92%', height: 320, background: 'rgba(222,237,255,0.58)', zIndex: 1 }} />

        {/* A live peek of the adjacent topic, revealed proportionally to how
            far the drag has travelled — item 3's "next card becomes visible
            behind it," gesture-linked in real time rather than only
            appearing once the swipe commits. */}
        {!reducedMotion && adjacentIndex !== undefined && adjacentIndex >= 0 && adjacentIndex < topics.length && dragOffset !== 0 ? (
          <div className="stack-peek" style={{ zIndex: 5, opacity: Math.min(0.85, Math.abs(rawProgress) * 1.8), transform: `scale(${0.94 + Math.min(1, Math.abs(rawProgress) * 2) * 0.06})` }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ opacity: 0.55, margin: '0 auto 8px' }}>
                <HeartIcon size={22} />
              </div>
              <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, color: 'var(--muted)' }}>{topics[adjacentIndex]?.title}</div>
            </div>
          </div>
        ) : null}

        {active !== undefined ? (
          // `key={active.id}` forces a remount on topic switch so the entrance
          // keyframe (`data-dir`) actually replays; the OUTGOING motion is a
          // plain CSS transition on `transform`, driven by `dragOffset`.
          <div
            key={active.id}
            className="stack-card highlight-sweep"
            data-dir={reducedMotion ? undefined : dir}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            style={{
              zIndex: 10,
              transform: dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined,
              transition: dragging ? 'none' : 'transform 260ms var(--spring)',
            }}
          >
            <div style={{ position: 'absolute', top: 18, right: 18, width: 40, height: 40, borderRadius: 20, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,160,160,0.38)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HeartIcon />
            </div>
            <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 22, color: 'var(--ink)', letterSpacing: -0.3, marginRight: 50 }}>{active.title}</div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.45, marginTop: 5 }}>{active.whenToUse}</p>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 190 }}>
              {active.steps.map((step) => (
                <div key={step.n} className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
                  <span className="step-badge">
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11, color: 'var(--primary)' }}>{step.n}</span>
                  </span>
                  <p style={{ flex: 1, fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 13, lineHeight: 1.45, color: 'var(--ink)', margin: 0, paddingTop: 4 }}>{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <p className="foot" style={{ textAlign: 'center' }}>Swipe, tap a category, or use the arrow keys to switch.</p>
      <p className="foot" style={{ textAlign: 'center' }}>{FIRST_AID_DISCLAIMER}</p>
    </div>
  );
}
