import { useCallback, useRef, useState } from 'react';

const HOLD_MS = 3000;

/**
 * Browser equivalent of packages/mobile/src/components/HoldDial.tsx — same
 * 3-second press-and-hold gate (spec §5.2's "confirmation screen, not a
 * single accidental tap"), driven by pointer events so it works with mouse,
 * touch and pen alike from one handler set. The server re-validates `heldMs`
 * itself (see routes/cases.ts's confirmSchema comment) — this is the UI
 * gate, not the enforcement.
 */
export function HoldButton({
  onComplete,
  disabled = false,
  label = 'Hold to confirm',
}: {
  readonly onComplete: (heldMs: number) => void;
  readonly disabled?: boolean;
  readonly label?: string;
}) {
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    startedAt.current = undefined;
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    if (startedAt.current === undefined) return;
    const elapsed = Date.now() - startedAt.current;
    const pct = Math.min(1, elapsed / HOLD_MS);
    setProgress(pct);
    if (pct >= 1) {
      const held = elapsed;
      stop();
      onComplete(held);
      return;
    }
    frame.current = requestAnimationFrame(tick);
  }, [onComplete, stop]);

  const start = useCallback(() => {
    if (disabled) return;
    startedAt.current = Date.now();
    frame.current = requestAnimationFrame(tick);
  }, [disabled, tick]);

  return (
    <button
      type="button"
      className="hold-button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        marginTop: 16,
        border: 'none',
        borderRadius: 16,
        padding: '16px 20px',
        fontFamily: 'var(--font-sans)',
        fontWeight: 700,
        fontSize: 14,
        color: '#fff',
        background: 'var(--danger)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        touchAction: 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(255,255,255,0.35)',
          transform: `scaleX(${progress})`,
          transformOrigin: 'left',
          transition: progress === 0 ? 'transform 0.15s ease' : 'none',
        }}
      />
      <span style={{ position: 'relative' }}>{progress > 0 ? 'Keep holding…' : label}</span>
    </button>
  );
}
