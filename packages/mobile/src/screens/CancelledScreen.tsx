/**
 * Alert cancelled — the design's `isCancelled` screen.
 *
 * ---------------------------------------------------------------------------
 * THE COPY IS THE FEATURE HERE.
 *
 *     "Calling and standing down is the system working as intended.
 *      Do it again the moment you are unsure."
 *
 * That sentence is doing real safety work and it is kept word for word. The
 * failure mode this screen exists to prevent is someone who cancelled once
 * hesitating the next time because they felt they had wasted somebody's time —
 * and hesitating is exactly what kills people in the cases this app is for.
 * There is no "are you sure?", no warning, and nothing that reads as a
 * reprimand.
 *
 * The design's green tick is the only green on any post-emergency screen, for
 * the same reason. Cancelling is a good outcome.
 * ---------------------------------------------------------------------------
 */

import { StyleSheet, Text, View } from 'react-native';
import { Label, PrimaryButton, SecondaryButton } from '../ui/primitives';
import { colors, fonts, glass, radius, shadow, spacing, type } from '../theme';

export function CancelledScreen({
  onReopen,
  onHome,
  /** Named only when notifications actually went out for this case. */
  notifiedContact,
}: {
  readonly onReopen: () => void;
  readonly onHome: () => void;
  readonly notifiedContact?: string;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.spacer} />

      <View style={[glass('strong'), styles.hero]}>
        <View style={styles.tick}>
          <Text style={styles.tickGlyph}>✓</Text>
        </View>
        <Text style={styles.title}>Alert cancelled</Text>
        <Text style={styles.body}>
          {notifiedContact === undefined
            ? 'The request has been stood down. Nothing was charged and nothing is held against your record.'
            : `The request has been stood down and ${notifiedContact} has been told you are all right. Nothing was charged and nothing is held against your record.`}
        </Text>
        <Text style={[styles.body, { marginTop: 11 }]}>
          Calling and standing down is the system working as intended. Do it again the moment you
          are unsure.
        </Text>
      </View>

      <View style={[glass('plain'), styles.card]}>
        <Label>YOUR CASE IS SAVED</Label>
        <Text style={[type.body, { color: colors.inkSoft, marginTop: 9 }]}>
          The interview, the tier changes and the timeline are all kept. If this comes back today,
          reopening the case is faster than starting again — and the agent already knows what you
          told it.
        </Text>
      </View>

      <PrimaryButton label="Start a new assessment" onPress={onReopen} />
      <SecondaryButton label="Back to home" onPress={onHome} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 13 },
  spacer: { height: 24 },
  hero: { borderRadius: radius.xxl, padding: 22, ...shadow('lift') },
  tick: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.okWash,
    borderWidth: 1,
    borderColor: 'rgba(21,128,61,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickGlyph: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.ok },
  title: {
    fontFamily: fonts.sansBlack,
    fontSize: 24,
    lineHeight: 28,
    color: colors.ink,
    marginTop: 15,
    letterSpacing: -0.5,
  },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 21, color: colors.inkSoft, marginTop: 9 },
  card: { padding: spacing.xl, borderRadius: radius.lg },
});
