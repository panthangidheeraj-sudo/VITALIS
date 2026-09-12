/**
 * The 3-second press-and-hold confirmation (spec 5.2, explicitly
 * non-negotiable: "never auto-call on a single tap").
 *
 * Design rules this component exists to enforce:
 *   - A tap does nothing. Only a sustained hold for the full duration fires.
 *   - Releasing early cancels and resets to zero - no partial credit, no
 *     resuming where you left off. That is the whole safeguard against a pocket
 *     press or a child pressing the screen.
 *   - Progress is continuously visible, so the user always knows how much
 *     longer to hold and that releasing will abort.
 *
 * The duration is imported from @triage/shared rather than written here, so the
 * UI and the server's validation cannot disagree about what "3 seconds" means.
 *
 * `onHoldComplete` receives the measured hold duration, which the caller sends
 * to the server for re-validation - the client asserting "confirmed" is not
 * sufficient (see routes/cases.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { PRESS_AND_HOLD_DURATION_MS } from '@triage/shared';
import { colors, radius, spacing, type } from '../theme';

interface Props {
  readonly label: string;
  readonly holdingLabel?: string;
  readonly onHoldComplete: (heldMs: number) => void;
  readonly disabled?: boolean;
  readonly style?: ViewStyle;
  /** Override only for tests; defaults to the shared constant. */
  readonly durationMs?: number;
}

export function PressAndHold({
  label,
  holdingLabel = 'Keep holding...',
  onHoldComplete,
  disabled = false,
  style,
  durationMs = PRESS_AND_HOLD_DURATION_MS,
}: Props) {
  const [holding, setHolding] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const startedAt = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    startedAt.current = undefined;
    setHolding(false);
    // Snap back rather than animate down: a slow unwind could read as "still
    // counting" for a moment, and this control must look unambiguously aborted.
    progress.setValue(0);
  }, [progress]);

  // Clear the pending timer if the screen goes away mid-hold - otherwise a
  // dispatch could fire after the user has navigated elsewhere.
  useEffect(() => reset, [reset]);

  const onPressIn = useCallback(() => {
    if (disabled) return;
    startedAt.current = Date.now();
    setHolding(true);

    Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: false, // animating width, which the native driver cannot do
    }).start();

    timer.current = setTimeout(() => {
      const heldMs = startedAt.current === undefined ? durationMs : Date.now() - startedAt.current;
      reset();
      onHoldComplete(heldMs);
    }, durationMs);
  }, [disabled, durationMs, onHoldComplete, progress, reset]);

  const onPressOut = useCallback(() => {
    progress.stopAnimation();
    reset();
  }, [progress, reset]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={style}>
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Press and hold for ${Math.round(durationMs / 1000)} seconds to confirm.`}
        style={[styles.button, disabled && styles.buttonDisabled]}
      >
        <Animated.View style={[styles.fill, { width }]} />
        <Text style={styles.label}>{holding ? holdingLabel : label}</Text>
      </Pressable>
      <Text style={styles.hint}>
        {holding
          ? 'Release to cancel'
          : `Hold for ${Math.round(durationMs / 1000)} seconds - a single tap will not confirm`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 68,
    borderRadius: radius.lg,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  buttonDisabled: {
    backgroundColor: colors.textFaint,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.dangerDark,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  hint: {
    ...type.small,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
