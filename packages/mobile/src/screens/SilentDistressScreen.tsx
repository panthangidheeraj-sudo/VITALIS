/**
 * Silent Distress Mode - a disguised screen that looks harmless while location
 * is shared with emergency contacts.
 *
 * THE THREAT MODEL, because it changes every design decision here: the user is
 * with someone who must not know they are calling for help. Domestic violence,
 * abduction, a hostile bystander. The person looking over their shoulder is
 * the adversary, not a stranger on the network.
 *
 * So:
 *  - THE DISGUISE MUST BE BORING. It renders a plain calculator. Anything
 *    branded, medical, or obviously "an app pretending" defeats the purpose.
 *  - NOTHING ON SCREEN INDICATES DISTRESS. No red, no countdown, no status
 *    text, no toast. The user gets no feedback at all, because feedback is
 *    visible to the adversary too. This is the one screen in the app where
 *    hiding what the system is doing is correct - everywhere else the opposite
 *    rule applies.
 *  - EXIT IS DELIBERATE AND UNLABELLED. A long-press on the display leaves the
 *    mode; nothing says so.
 *  - THE CALCULATOR ACTUALLY WORKS. A fake one that does nothing when tapped
 *    is more suspicious than no disguise at all.
 *
 * LIMIT, STATED PLAINLY: this disguises the SCREEN. It cannot disguise the
 * phone. Notifications from other apps, the lock screen, and anyone who force-
 * quits and reopens the app will not see this. It raises the effort required
 * to notice; it does not make detection impossible, and it should never be
 * described to a user as if it did.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
// Only radius/spacing come from the theme: this screen deliberately wears the
// platform calculator's colours, not the app's, because looking like VITALIS
// is exactly what it must not do.
import { radius, spacing } from '../theme';

interface Props {
  /** Fires immediately on mount, then on the interval, while the mode is on. */
  readonly onSharePing: () => void;
  readonly onExit: () => void;
  /** How often location is re-shared. */
  readonly pingIntervalMs?: number;
}

const KEYS = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
] as const;

export function SilentDistressScreen({ onSharePing, onExit, pingIntervalMs = 60_000 }: Props) {
  const [display, setDisplay] = useState('0');
  const [pending, setPending] = useState<{ value: number; op: string } | undefined>(undefined);
  const [fresh, setFresh] = useState(true);
  const pingRef = useRef(onSharePing);
  pingRef.current = onSharePing;

  useEffect(() => {
    // First ping is immediate: the whole point is that help knows where they
    // are as soon as the mode is entered, not a minute later.
    pingRef.current();
    const id = setInterval(() => pingRef.current(), pingIntervalMs);
    return () => clearInterval(id);
  }, [pingIntervalMs]);

  const press = useCallback(
    (key: string) => {
      if (key === 'C') {
        setDisplay('0');
        setPending(undefined);
        setFresh(true);
        return;
      }
      if (/[0-9.]/.test(key)) {
        setDisplay((d) => (fresh || d === '0' ? (key === '.' ? '0.' : key) : d + key));
        setFresh(false);
        return;
      }
      if (key === '±') {
        setDisplay((d) => (d.startsWith('-') ? d.slice(1) : '-' + d));
        return;
      }

      const current = Number(display);
      if (key === '=') {
        if (pending === undefined) return;
        setDisplay(String(apply(pending.value, current, pending.op)));
        setPending(undefined);
        setFresh(true);
        return;
      }
      // An operator: fold any pending operation first, so 2+3+4 works.
      const folded = pending === undefined ? current : apply(pending.value, current, pending.op);
      setPending({ value: folded, op: key });
      setDisplay(String(folded));
      setFresh(true);
    },
    [display, fresh, pending],
  );

  return (
    <View style={styles.screen}>
      {/* Long-press the display to leave. Nothing labels this, by design. */}
      <Pressable onLongPress={onExit} delayLongPress={1500} style={styles.displayWrap}>
        <Text style={styles.display} numberOfLines={1} adjustsFontSizeToFit>
          {display}
        </Text>
      </Pressable>

      <View style={styles.pad}>
        {KEYS.map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map((key) => (
              <Pressable
                key={key}
                onPress={() => press(key)}
                style={[
                  styles.key,
                  key === '0' && styles.keyWide,
                  /[÷×−+=]/.test(key) && styles.keyOp,
                ]}
              >
                <Text style={[styles.keyText, /[÷×−+=]/.test(key) && styles.keyOpText]}>{key}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function apply(a: number, b: number, op: string): number {
  switch (op) {
    case '+':
      return a + b;
    case '−':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b === 0 ? 0 : a / b;
    default:
      return b;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1C1C1E', justifyContent: 'flex-end' },
  displayWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.xl },
  display: { color: '#FFFFFF', fontSize: 76, fontWeight: '300', textAlign: 'right' },
  pad: { padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  key: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.pill,
    backgroundColor: '#333336',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: { flex: 2.15, aspectRatio: undefined },
  keyOp: { backgroundColor: '#FF9F0A' },
  keyText: { color: '#FFFFFF', fontSize: 30, fontWeight: '500' },
  keyOpText: { color: '#FFFFFF' },
});
