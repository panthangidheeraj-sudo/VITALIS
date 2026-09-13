/**
 * The wave field behind the assistant screen.
 *
 * The design draws this with a WebGL fragment shader (design/vitalis-lines.js):
 * three bands of soft horizontal sine lines, drifting slowly, tinted along a
 * blue gradient. React Native in Expo Go has no WebGL context available without
 * a native build, so this reproduces the same motif with react-native-svg.
 *
 * WHAT IS THE SAME: three bands, 3/4/5 lines, the same #1D4ED8 → #60A5FA →
 * #BFDBFE ramp, the same slow phase drift, the same overall opacity.
 *
 * WHAT IS NOT: the shader's lines glow — its `0.0175 / |m|` falloff makes each
 * line a soft bloom rather than a stroke. Stroked paths cannot do that, so
 * these are thin strokes at low opacity, which reads as quieter and flatter
 * from close up and near-identical at a glance.
 *
 * It is DECORATION and it is allowed to fail. Nothing about the assistant
 * screen depends on it rendering, which is why it takes no props that could
 * make it wrong and has no error path of its own.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const BANDS = [
  { y: 0.26, lines: 3, spacing: 16, color: '#1D4ED8' },
  { y: 0.5, lines: 4, spacing: 13, color: '#60A5FA' },
  { y: 0.76, lines: 5, spacing: 10, color: '#BFDBFE' },
] as const;

const WIDTH = 360;
const HEIGHT = 520;
/** ~8 fps. Invisible motion does not need 60, and this runs behind a chat. */
const TICK_MS = 120;

export function WaveField() {
  const [phase, setPhase] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      frame.current += 1;
      setPhase(frame.current * 0.04);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {BANDS.flatMap((band, b) =>
          Array.from({ length: band.lines }, (_, i) => {
            const offset = (i - (band.lines - 1) / 2) * band.spacing;
            const centre = band.y * HEIGHT + offset;
            return (
              <Path
                key={`${b}-${i}`}
                d={sinePath(centre, phase + b * 1.7 + i * 0.55)}
                stroke={band.color}
                strokeWidth={1.1}
                fill="none"
                opacity={0.3}
              />
            );
          }),
        )}
      </Svg>
    </View>
  );
}

/**
 * One sine line across the full width.
 *
 * Amplitude itself oscillates with the phase, which is what gives the shader
 * its breathing quality — lines that only slide look like a screensaver.
 */
function sinePath(centre: number, phase: number): string {
  const amplitude = 10 + Math.sin(phase * 0.3) * 7;
  const points: string[] = [];
  for (let x = 0; x <= WIDTH; x += 18) {
    const y = centre + Math.sin(x / 70 + phase) * amplitude;
    points.push(`${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.45 },
});
