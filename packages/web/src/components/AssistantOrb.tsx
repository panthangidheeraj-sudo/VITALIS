/**
 * The Assistant screen's hero orb — ported from
 * packages/mobile/src/screens/AssistantScreen.tsx's hero (outer glow ring +
 * core + pulsing dot, shown before the conversation starts), with the
 * "assembling into position" entrance the original design has and the
 * mobile port's static mount never added.
 *
 * SIX-STEP SEQUENCE, each layer staggered by CSS `animation-delay` on the
 * SAME mount (no JS timers, no per-frame state): outer glow emerges, the
 * ring follows with a small rotational settle, the core scales into place,
 * the centre dot pops in, a small status dot confirms "connected," and only
 * then does the dot's idle pulse loop begin — chained as a second
 * comma-separated animation on the same element, timed to start exactly
 * when the entrance animation ends. This is deliberately NOT a loading
 * spinner: nothing here loops until the very last, smallest element, and
 * everything else settles to a static final state.
 */

export function AssistantOrb() {
  return (
    <div className="assistant-orb" aria-hidden="true">
      <div className="orb-glow">
        <div className="orb-ring" />
        <div className="orb-core">
          <div className="orb-dot" />
        </div>
        <div className="orb-status" />
      </div>
    </div>
  );
}
