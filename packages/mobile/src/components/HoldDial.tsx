/**
 * The hold dial — spec §5.2's press-and-hold confirmation, drawn as the design
 * draws it.
 *
 * ---------------------------------------------------------------------------
 * THE SAFETY PROPERTY, WHICH THE VISUAL SERVES
 *
 *   - A tap does nothing. Only a sustained hold for the full duration fires.
 *   - Releasing early resets to ZERO. No partial credit, no resuming. That is
 *     the entire safeguard against a pocket press or a child on the screen,
 *     and the ring snapping back to empty is how the user learns it.
 *   - Progress is continuously visible, so it is always obvious both how much
 *     longer to hold and that letting go will abort.
 *
 * `PRESS_AND_HOLD_DURATION_MS` is imported from @triage/shared, never written
 * here. The server re-validates the measured hold against that same constant
 * (packages/server/src/routes/cases.ts), so the animation and the policy have
 * one definition. A dial that fills in 2.5s while the server demands 3.0s would
 * be a UI that teaches people the gate is broken.
 * ---------------------------------------------------------------------------
 *
 * The design uses `conic-gradient` for the ring, which React Native has no
 * equivalent of. An SVG arc with an animated `strokeDashoffset` is the right
 * shape anyway — and unlike the conic gradient it can round its leading edge,
 * which makes partial progress read as progress rather than as a pie chart.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { PRESS_AND_HOLD_DURATION_MS } from '@triage/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, shadow } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 132;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function HoldDial({
  onHoldComplete,
  disabled = false,
  durationMs = PRESS_AND_HOLD_DURATION_MS,
}: {
  readonly onHoldComplete: (heldMs: number) => void;
  readonly disabled?: boolean;
  /** Override only for tests; defaults to the shared constant. */
  readonly durationMs?: number;
}) {
  const [holding, setHolding] = useState(false);
  const [remaining, setRemaining] = useState(durationMs);
  const progress = useRef(new Animated.Value(0)).current;
  const startedAt = useRef<number | undefined>(undefined);
  const completion = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const reset = useCallback(() => {
    if (completion.current !== undefined) clearTimeout(completion.current);
    if (ticker.current !== undefined) clearInterval(ticker.current);
    completion.current = undefined;
    ticker.current = undefined;
    startedAt.current = undefined;
    setHolding(false);
    setRemaining(durationMs);
    progress.stopAnimation();
    // Snapping to empty rather than animating back is deliberate: an eased
    // retreat looks like the hold is still partly banked, and it is not.
    progress.setValue(0);
  }, [durationMs, progress]);

  useEffect(() => reset, [reset]);

  const start = useCallback(() => {
    if (disabled) return;
    startedAt.current = Date.now();
    setHolding(true);
    setRemaining(durationMs);

    Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.linear,
      // strokeDashoffset is not a transform or an opacity, so this cannot run
      // on the UI thread. At one animated property on an otherwise static
      // screen that is fine, and correctness here beats smoothness.
      useNativeDriver: false,
    }).start();

    ticker.current = setInterval(() => {
      const held = Date.now() - (startedAt.current ?? Date.now());
      setRemaining(Math.max(0, durationMs - held));
    }, 50);

    completion.current = setTimeout(() => {
      const heldMs = Date.now() - (startedAt.current ?? Date.now());
      reset();
      // The MEASURED duration is reported, not the nominal one. The server
      // re-checks it, and sending a constant would make the client's claim
      // unfalsifiable — which is the thing the server-side check exists to
      // avoid trusting.
      onHoldComplete(heldMs);
    }, durationMs);
  }, [disabled, durationMs, onHoldComplete, progress, reset]);

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [CIRCUMFERENCE, 0],
  });

  return (
    <View style={styles.wrap}>
      <Pressable
        onPressIn={start}
        onPressOut={reset}
        disabled={disabled}
        style={styles.dial}
        // Without this the gesture is stolen by the enclosing ScrollView the
        // moment a finger drifts a pixel, and the hold silently resets.
        onStartShouldSetResponder={() => true}
      >
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="rgba(220,38,38,0.16)"
            strokeWidth={STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={colors.danger}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
            // Start the sweep at twelve o'clock, not three.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>

        <LinearGradient
          colors={['rgba(224,54,54,0.95)', 'rgba(193,29,29,0.98)']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[styles.core, holding ? { transform: [{ scale: 0.96 }] } : null]}
        >
          <Text style={styles.hold}>HOLD</Text>
          <Text style={styles.count}>
            {holding ? `${(remaining / 1000).toFixed(1)}s` : `${Math.round(durationMs / 1000)} SEC`}
          </Text>
        </LinearGradient>
      </Pressable>

      <Text style={styles.hint}>
        Hold the full {Math.round(durationMs / 1000)} seconds. Letting go resets it — a single tap
        never dials.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, marginTop: 16 },
  dial: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: SIZE - 24,
    height: SIZE - 24,
    borderRadius: (SIZE - 24) / 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    ...shadow('lift'),
  },
  hold: { fontFamily: fonts.sansBlack, fontSize: 13, color: colors.white, letterSpacing: 0.5 },
  count: { fontFamily: fonts.monoSemi, fontSize: 11, color: 'rgba(255,255,255,0.9)' },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: colors.slate,
    textAlign: 'center',
  },
});
