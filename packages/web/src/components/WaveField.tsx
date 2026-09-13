/**
 * The drifting wave-line background behind the Assistant screen.
 *
 * THE DESIGN SOURCE (vitalis-lines.js, in the uploaded reference) draws this
 * with a WebGL fragment shader via three.js: three bands of glowing sine
 * lines drifting slowly, tinted along a blue gradient, reacting to the
 * pointer. Pulling in three.js here for one decorative background would be
 * exactly the "expensive continuous animation" this port was told to avoid —
 * a persistent WebGL context and render loop for a few wavy lines is a bad
 * trade in a browser tab that might sit open all day, and the mobile app
 * already made the same call for the same reason (see its own WaveField.tsx,
 * which this is a direct port of): three bands, 3/4/5 lines, the same
 * #1D4ED8 → #60A5FA → #BFDBFE ramp, the same slow drift, reproduced with
 * plain SVG + a CSS transform animation instead of a shader.
 *
 * NEVER RECOMPUTES PATH DATA. Each line's `d` is built once, at exactly one
 * period wider than the viewport, from a periodic sine — so its right edge
 * is identical to its left edge shifted by one wavelength. All the motion is
 * a single CSS `translateX` keyframe animation per band (GPU-composited,
 * no JS on every frame), and because a full-wavelength shift looks identical
 * to no shift, the loop point is invisible.
 */

import { useMemo } from 'react';

const WIDTH = 480;
const HEIGHT = 520;

const BANDS = [
  { y: 0.26, lines: 3, spacing: 16, color: '#1D4ED8', period: 260, durationS: 22 },
  { y: 0.5, lines: 4, spacing: 13, color: '#60A5FA', period: 220, durationS: 17 },
  { y: 0.76, lines: 5, spacing: 10, color: '#BFDBFE', period: 190, durationS: 13 },
] as const;

export function WaveField() {
  return (
    <div className="wave-field" aria-hidden="true">
      {BANDS.map((band, i) => (
        <Band key={i} band={band} />
      ))}
    </div>
  );
}

function Band({ band }: { readonly band: (typeof BANDS)[number] }) {
  const totalWidth = WIDTH + band.period;
  const paths = useMemo(() => {
    const offsets = Array.from({ length: band.lines }, (_, i) => (i - (band.lines - 1) / 2) * band.spacing);
    return offsets.map((offset) => sinePath(band.y * HEIGHT + offset, band.period, totalWidth));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band.lines, band.period, band.spacing, band.y]);

  return (
    <svg
      className="wave-band"
      width={totalWidth}
      height={HEIGHT}
      viewBox={`0 0 ${totalWidth} ${HEIGHT}`}
      style={{ animationDuration: `${band.durationS}s`, ['--wave-shift' as string]: `-${band.period}px` }}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} stroke={band.color} strokeWidth={1.1} fill="none" opacity={0.3} />
      ))}
    </svg>
  );
}

/** One period wider than the viewport — see the file header. */
function sinePath(centre: number, period: number, totalWidth: number): string {
  const amplitude = 12;
  const points: string[] = [];
  for (let x = 0; x <= totalWidth; x += 16) {
    const y = centre + Math.sin((x / period) * 2 * Math.PI) * amplitude;
    points.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(0)} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}
