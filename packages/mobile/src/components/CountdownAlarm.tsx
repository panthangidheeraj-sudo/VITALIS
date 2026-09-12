/**
 * The cancellable countdown that stands between an AUTOMATIC trigger and any
 * emergency action.
 *
 * Used by fall detection and Guardian Mode. Both of those fire without the
 * user asking, which makes them categorically different from the SOS button:
 * the user has not confirmed anything, so the system must assume it might be
 * wrong and give them an easy way out.
 *
 * Design rules here are safety requirements, not preferences:
 *
 *  - CANCEL IS THE BIG BUTTON. The destructive path (raise the alarm) is the
 *    default-on-timeout, so the visible, thumb-sized control is the one that
 *    stops it. Making "call an ambulance" the big button would be backwards -
 *    it happens anyway if the user does nothing.
 *  - A SINGLE TAP CANCELS. No hold, no confirm dialog. Someone who has just
 *    dropped their phone should not have to fight the UI.
 *  - THE COUNTDOWN IS LOUD AND LITERAL. Seconds remaining, in the largest type
 *    on screen, so a bystander can read it too.
 *  - IT SAYS WHY IT FIRED. "Possible fall detected" rather than an unexplained
 *    alarm, so the user can judge in one second whether it is wrong.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, Vibration } from 'react-native';
import { colors, radius, spacing, type } from '../theme';

interface Props {
  readonly title: string;
  readonly reason: string;
  readonly seconds: number;
  readonly onCancel: () => void;
  readonly onElapsed: () => void;
}

export function CountdownAlarm({ title, reason, seconds, onCancel, onElapsed }: Props) {
  const [remaining, setRemaining] = useState(seconds);
  // Held in a ref so the interval closure always calls the current callback
  // without needing to be torn down and rebuilt every second.
  const elapsedRef = useRef(onElapsed);
  elapsedRef.current = onElapsed;

  useEffect(() => {
    // Vibration is the point of this screen when the phone is in a pocket and
    // the user cannot see it. Pattern repeats until the component unmounts.
    Vibration.vibrate([0, 600, 400], true);
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          elapsedRef.current();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      clearInterval(id);
      Vibration.cancel();
    };
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>AUTOMATIC ALERT</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.reason}>{reason}</Text>

        <Text style={styles.count}>{remaining}</Text>
        <Text style={styles.countLabel}>
          {remaining === 1 ? 'second' : 'seconds'} until your emergency contacts are alerted
        </Text>
      </View>

      {/* The large control stops the alarm. Doing nothing is what raises it. */}
      <Pressable
        style={styles.cancel}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="I am OK, cancel this alert"
      >
        <Text style={styles.cancelText}>I'm OK - Cancel</Text>
      </Pressable>
      <Text style={styles.footnote}>
        No ambulance is called by this countdown. It alerts your contacts and opens triage.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.danger, padding: spacing.lg, justifyContent: 'space-between' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  eyebrow: { color: '#FFFFFFCC', fontSize: 12, letterSpacing: 1.4, fontWeight: '700' },
  title: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', textAlign: 'center' },
  reason: { color: '#FFFFFFDD', fontSize: 15, textAlign: 'center', marginBottom: spacing.lg },
  count: { color: '#FFFFFF', fontSize: 120, fontWeight: '800', lineHeight: 128 },
  countLabel: { color: '#FFFFFFDD', fontSize: 15, textAlign: 'center', paddingHorizontal: spacing.xl },
  cancel: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  cancelText: { color: colors.danger, fontSize: 22, fontWeight: '800' },
  footnote: { ...type.tiny, color: '#FFFFFFAA', textAlign: 'center', marginTop: spacing.md },
});
