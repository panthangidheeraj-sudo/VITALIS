/**
 * The wave field behind the assistant screen.
 *
 * The design draws this with a WebGL fragment shader (design/vitalis-lines.js):
 * three bands of soft horizontal sine lines, drifting slowly, tinted along a
 * blue gradient. React Native in Expo Go has no WebGL context available without
 * a native build, so this reproduces the same motif with react-native-svg.
 *
 * ---------------------------------------------------------------------------
 * REWRITTEN once already, for a real bug: the first version recomputed all
 * twelve `<Path d="...">` strings on every tick via `setState` in a
 * `setInterval`, roughly 8 times a second. That is a full SVG re-parse and
 * re-layout of every line, every tick, on the JS thread — on a phone under
 * any load (a fresh Metro connection, a background Firestore listener
 * mounting) the ticks fall behind, catch up in a burst, and the lines visibly
 * jump: what reads as "glitching, spawning and despawning."
 *
 * THIS VERSION NEVER CHANGES PATH DATA. Each line's `d` is computed once, at
 * double the viewport width, drawn from a periodic sine so its right half is
 * identical to its left half shifted by one wavelength. Motion comes entirely
 * from `translateX` on an `Animated.Value` driven with `useNativeDriver: true`
 * — the animation runs on the native UI thread, decoupled from the JS thread
 * entirely, and loops seamlessly because a full-wavelength shift is visually
 * identical to no shift at all. Nothing here calls `setState` after mount.
 *
 * WHAT IS THE SAME AS THE DESIGN: three bands, 3/4/5 lines, the same
 * #1D4ED8 → #60A5FA → #BFDBFE ramp, the same slow drift, the same overall
 * opacity. WHAT IS NOT: the shader's lines glow via a `1/|distance|` falloff;
 * stroked paths cannot bloom, so these are thin strokes at low opacity, which
 * reads as quieter and flatter close up and near-identical at a glance.
 *
 * It is DECORATION and it is allowed to fail. Nothing about the assistant
 * screen depends on it rendering, which is why it takes no props that could
 * make it wrong.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

const BANDS = [
  { y: 0.26, lines: 3, spacing: 16, color: '#1D4ED8', periodPx: 260, durationMs: 22000 },
  { y: 0.5, lines: 4, spacing: 13, color: '#60A5FA', periodPx: 220, durationMs: 17000 },
  { y: 0.76, lines: 5, spacing: 10, color: '#BFDBFE', periodPx: 190, durationMs: 13000 },
] as const;

const WIDTH = 360;
const HEIGHT = 520;

export function WaveField() {
  return (
    <View style={styles.wrap} pointerEvents="none">
      {BANDS.map((band, i) => (
        <Band key={i} band={band} />
      ))}
    </View>
  );
}

function Band({ band }: { readonly band: (typeof BANDS)[number] }) {
  const shift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shift, {
        toValue: 1,
        duration: band.durationMs,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [band.durationMs, shift]);

  // 0 -> 1 maps to sliding exactly one period leftward, which is where the
  // doubled-width path repeats itself — the loop point is invisible.
  const translateX = shift.interpolate({ inputRange: [0, 1], outputRange: [0, -band.periodPx] });

  const paths = useMemo(() => {
    const offsets = Array.from({ length: band.lines }, (_, i) => (i - (band.lines - 1) / 2) * band.spacing);
    return offsets.map((offset, i) => ({
      key: i,
      d: sinePath(band.y * HEIGHT + offset, band.periodPx),
    }));
  }, [band.lines, band.periodPx, band.spacing, band.y]);

  return (
    <AnimatedSvg
      width={WIDTH + band.periodPx}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH + band.periodPx} ${HEIGHT}`}
      style={[styles.svg, { transform: [{ translateX }] }]}
    >
      {paths.map((p) => (
        <Path key={p.key} d={p.d} stroke={band.color} strokeWidth={1.1} fill="none" opacity={0.3} />
      ))}
    </AnimatedSvg>
  );
}

/**
 * A sine line drawn across `WIDTH + period`, one period wider than the
 * viewport, so that translating it left by exactly `period` px lands back on
 * an identical frame — the seam where the loop restarts is never visible.
 */
function sinePath(centre: number, period: number): string {
  const amplitude = 12;
  const totalWidth = WIDTH + period;
  const points: string[] = [];
  for (let x = 0; x <= totalWidth; x += 16) {
    const y = centre + Math.sin((x / period) * 2 * Math.PI) * amplitude;
    points.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(0)} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.5, overflow: 'hidden' },
  svg: { position: 'absolute', top: 0, left: 0 },
});
