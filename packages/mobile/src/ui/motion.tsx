/**
 * The design's CSS keyframes (`vfadeup`, `vpop`, `vpulse`, `vbreathe`,
 * `vgrowy`, `vgrowx`), transcribed to `Animated` — React Native has no CSS
 * animations, so each keyframe became a small wrapper component with the
 * SAME duration, delay and easing curve read off design/VitalisApp.dc.html,
 * rather than an invented substitute.
 *
 * `useNativeDriver: true` everywhere: every animated property here is
 * opacity/transform, the only two the native driver supports, and this is a
 * screen that includes a 3-second press-and-hold gate — a JS-thread
 * animation stutter is not acceptable competition for that gesture.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/** cubic-bezier(.22,1,.36,1) — the design's own "pop" curve. */
const POP_BEZIER = Easing.bezier(0.22, 1, 0.36, 1);

/** `vfadeup .4s ease .04s both` — opacity 0→1, translateY 10px→0. */
export function FadeUp({
  children,
  delayMs = 0,
  durationMs = 400,
  style,
}: {
  readonly children: React.ReactNode;
  readonly delayMs?: number;
  readonly durationMs?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      delay: delayMs,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [durationMs, delayMs, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** `vpop .45s cubic-bezier(.22,1,.36,1) both` — scale .85→1, opacity 0→1. */
export function PopIn({
  children,
  delayMs = 0,
  durationMs = 450,
  style,
}: {
  readonly children: React.ReactNode;
  readonly delayMs?: number;
  readonly durationMs?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      delay: delayMs,
      easing: POP_BEZIER,
      useNativeDriver: true,
    }).start();
  }, [durationMs, delayMs, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * `vpulse Ns ease-in-out infinite` — opacity .55↔1, scale 1↔1.12, looping.
 * Used on the design's small "live" dots (Home's Connected row, the
 * Assistant orb's core, Companion's STILL MONITORING dot) — never on
 * anything conveying a risk tier, which must never appear to "throb".
 */
export function Pulse({
  children,
  periodMs = 2400,
  style,
}: {
  readonly children?: React.ReactNode;
  readonly periodMs?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: periodMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: periodMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [periodMs, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** `vbreathe Ns ease-in-out infinite` — scale 1↔1.015, looping. A near-still card. */
export function Breathe({
  children,
  periodMs = 4200,
  style,
}: {
  readonly children: React.ReactNode;
  readonly periodMs?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: periodMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: periodMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [periodMs, progress]);

  return (
    <Animated.View
      style={[style, { transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }) }] }]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * `vgrowy .5s ease-out Ns both` — scaleY 0→1 from the bottom edge.
 * `transformOrigin` is not a React Native style — the bottom-anchored grow
 * is achieved by animating `height` instead of `scaleY` (which would
 * otherwise grow from the view's centre), the one property here that is not
 * native-driver-eligible; acceptable for five short-lived one-shot bars.
 */
export function GrowBarY({
  heightPct,
  color,
  delayMs = 0,
  style,
}: {
  readonly heightPct: number;
  readonly color: string;
  readonly delayMs?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: heightPct,
      duration: 500,
      delay: delayMs,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [heightPct, delayMs, progress]);

  return (
    <Animated.View
      style={[style, { height: progress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), backgroundColor: color }]}
    />
  );
}

/** `vgrowx .6s ease-out .2s both` — scaleX 0→1 from the left edge. */
export function GrowBarX({
  children,
  delayMs = 200,
  durationMs = 600,
  style,
}: {
  readonly children?: React.ReactNode;
  readonly delayMs?: number;
  readonly durationMs?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      delay: delayMs,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [durationMs, delayMs, progress]);

  return (
    <Animated.View style={[style, { transform: [{ scaleX: progress }] }]}>{children}</Animated.View>
  );
}
