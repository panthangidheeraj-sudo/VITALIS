import { Logo } from './Logo';

/**
 * The Assistant screen's hero mark.
 *
 * This WAS a generic concentric orb (glow ring + core + pulsing dot). It is
 * now the actual VITALIS logo — the same `public/assets/vitalis-logo.svg`
 * every other brand-mark location renders, through the same `Logo`
 * component, so there is still exactly one copy of the asset and one place
 * that knows its path.
 *
 * WHAT IS DELIBERATELY ABSENT: no ring, no core, no second circle, nothing
 * drawn around or over the mark. The logo is the identity here, so the only
 * surrounding treatment is light — a soft blue radial glow behind it — and
 * it is painted BEHIND the logo rather than as a shape the logo sits inside.
 * The mark keeps its own square aspect and corner radius untouched.
 *
 * The entrance is the orb's `orb-emerge` (opacity + scale, one layer instead
 * of the old six-step stagger); the surrounding fade-up delays on the heading
 * beneath it are unchanged, so the sequence still reads in the same order.
 */

/** Close to the old orb's 118px footprint, so the block it sits in keeps its size. */
const LOGO_SIZE = 96;

export function AssistantOrb() {
  return (
    <div className="assistant-orb" aria-hidden="true">
      <div className="orb-glow">
        <div className="orb-logo">
          <Logo size={LOGO_SIZE} />
        </div>
      </div>
    </div>
  );
}
