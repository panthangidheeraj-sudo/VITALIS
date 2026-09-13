/**
 * The pieces every Vitalis screen is assembled from.
 *
 * The design repeats a small number of surfaces — a glass card, a mono
 * micro-label above a value, a blue primary button, a dark ledger panel — many
 * times per screen with slightly different inline styles. Transcribing that
 * literally would produce twelve screens nobody can keep consistent. These are
 * those surfaces, named, so a change to the glass happens once.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  brandWash,
  colors,
  fonts,
  glass,
  radius,
  shadow,
  spacing,
  type,
} from '../theme';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * The mono micro-label that sits above almost every value in this design.
 *
 * It exists as a component rather than a style because it is used ~60 times and
 * because its letter-spacing is the detail most likely to be quietly dropped in
 * a hand-written copy — and without it every screen looks like a different app.
 */
export function Label({
  children,
  color,
  style,
}: {
  readonly children: ReactNode;
  readonly color?: string;
  readonly style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={[type.label, color === undefined ? null : { color }, style]}>{children}</Text>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  tone = 'plain',
  style,
}: {
  readonly children: ReactNode;
  readonly tone?: 'plain' | 'blue' | 'strong';
  readonly style?: StyleProp<ViewStyle>;
}) {
  return <View style={[glass(tone), styles.cardPad, style]}>{children}</View>;
}

/**
 * A card whose left edge carries a 4px accent bar.
 *
 * The design uses this shape for exactly the things the patient must not skim
 * past — the degradation banner, the re-plan notice, the unresolved
 * contradiction — so the accent is doing semantic work, not decoration.
 */
export function NoticeCard({
  children,
  accent,
  background,
  border,
  style,
}: {
  readonly children: ReactNode;
  readonly accent: string;
  readonly background: string;
  readonly border: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.cardPad,
        {
          backgroundColor: background,
          borderWidth: 1,
          borderColor: border,
          borderLeftWidth: 4,
          borderLeftColor: accent,
          borderRadius: radius.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/**
 * The blue gradient button.
 *
 * `onPress` is optional so a button can be rendered in its disabled state
 * without a no-op handler at every call site — and a button with no handler is
 * rendered visibly inert rather than looking live and doing nothing, which on
 * an emergency screen is the difference between "it is loading" and "I pressed
 * it and nothing happened".
 */
export function PrimaryButton({
  label,
  onPress,
  busy = false,
  disabled = false,
  style,
}: {
  readonly label: string;
  readonly onPress?: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || busy || onPress === undefined;
  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      style={({ pressed }) => [
        { borderRadius: radius.md, overflow: 'hidden', opacity: inert ? 0.55 : 1 },
        pressed && !inert ? { transform: [{ scale: 0.97 }] } : null,
        shadow('lift'),
        style,
      ]}
    >
      <LinearGradient
        colors={brandWash.colors}
        start={brandWash.start}
        end={brandWash.end}
        style={styles.primaryInner}
      >
        {busy ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.primaryLabel}>{label}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

/** The quieter button: a tinted blue fill, no gradient, no shadow. */
export function SecondaryButton({
  label,
  onPress,
  style,
}: {
  readonly label: string;
  readonly onPress?: () => void;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondary,
        pressed ? { transform: [{ scale: 0.97 }] } : null,
        style,
      ]}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * The outlined red button, used only for Cancel Alert.
 *
 * Outlined rather than filled, deliberately and per the design: cancelling is
 * always available and must always be findable, but it should not compete
 * visually with the action that summons help.
 */
export function DangerOutlineButton({
  label,
  onPress,
  style,
}: {
  readonly label: string;
  readonly onPress?: () => void;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dangerOutline,
        pressed ? { transform: [{ scale: 0.97 }], backgroundColor: colors.dangerWash } : null,
        style,
      ]}
    >
      <Text style={styles.dangerOutlineLabel}>{label}</Text>
    </Pressable>
  );
}

/** The `← Back` affordance at the top of every secondary screen. */
export function BackLink({
  label = 'Back',
  onPress,
}: {
  readonly label?: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.backLink, pressed ? { opacity: 0.5 } : null]}
    >
      <Text style={styles.backLinkLabel}>{`← ${label}`}</Text>
    </Pressable>
  );
}

/** A pill, used for symptom tags and first-aid guide tabs. */
export function Pill({
  label,
  selected,
  critical = false,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  /** Marks the seven tags the design outlines in red before selection. */
  readonly critical?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        selected
          ? { backgroundColor: 'rgba(220,38,38,0.85)', borderColor: 'rgba(255,255,255,0.4)' }
          : {
              backgroundColor: colors.surfaceStrong,
              borderColor: critical ? 'rgba(220,38,38,0.35)' : colors.hairline,
            },
        pressed ? { transform: [{ scale: 0.94 }] } : null,
      ]}
    >
      <Text
        style={[
          styles.pillLabel,
          { color: selected ? colors.white : colors.inkSoft },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

/** A `LABEL` / `value` stack. The most repeated shape in the whole design. */
export function Stat({
  label,
  value,
  unit,
  style,
  valueStyle,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly valueStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[glass('blue'), styles.statCard, style]}>
      <Label>{label}</Label>
      <Text style={[type.metric, styles.statValue, valueStyle]}>
        {value}
        {unit === undefined ? null : <Text style={styles.statUnit}>{unit}</Text>}
      </Text>
    </View>
  );
}

/**
 * A horizontally scrolling strip of timestamped events.
 *
 * Horizontal, as in the design, because a vertical timeline on a phone forces
 * every other panel below the fold. `activeIndex` is highlighted and the rest
 * are dimmed, so "where are we now" survives being glanced at.
 */
export function TimelineStrip({
  entries,
  activeIndex,
}: {
  readonly entries: readonly { readonly at: string; readonly text: string }[];
  readonly activeIndex: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.stripContent}
    >
      {entries.map((entry, i) => {
        const active = i === activeIndex;
        return (
          <View
            key={`${entry.at}-${i}`}
            style={[
              styles.stripCard,
              active
                ? { backgroundColor: 'rgba(29,78,216,0.12)', borderColor: 'rgba(29,78,216,0.35)' }
                : { backgroundColor: colors.surfaceSoft, borderColor: colors.hairline, opacity: 0.6 },
            ]}
          >
            <Text style={styles.stripTime}>{entry.at}</Text>
            <Text style={styles.stripText}>{entry.text}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * The tool-call ledger panel.
 *
 * The one dark surface in the app, and the design is right to make it look like
 * a terminal: it is the only place showing what the agent actually DID rather
 * than what it concluded, and it should read as a log, not as a feature.
 *
 * `rows` come from the live Firestore ledger. The design's mock rows named
 * Infermedica endpoints this system does not call — see design/README.md.
 */
export function LedgerPanel({
  rows,
  title = 'TOOL-CALL LEDGER · LIVE',
  emptyNote = 'No tool calls yet. The first turn will fill this.',
}: {
  readonly rows: readonly { readonly at: string; readonly call: string; readonly ms: string }[];
  readonly title?: string;
  readonly emptyNote?: string;
}) {
  return (
    <View style={styles.ledger}>
      <Label color={colors.ledgerDim} style={{ marginBottom: spacing.sm }}>
        {title}
      </Label>
      {rows.length === 0 ? (
        <Text style={styles.ledgerEmpty}>{emptyNote}</Text>
      ) : (
        rows.map((row, i) => (
          <View key={`${row.at}-${i}`} style={styles.ledgerRow}>
            <Text style={styles.ledgerAt}>{row.at}</Text>
            <Text style={styles.ledgerCall} numberOfLines={1}>
              {row.call}
            </Text>
            <Text style={styles.ledgerMs}>{row.ms}</Text>
          </View>
        ))
      )}
    </View>
  );
}

/** Five bars. Confidence, deliberately drawn in greys — never in tier colour. */
export function ConfidenceBars({ filled }: { readonly filled: number }) {
  return (
    <View style={styles.bars}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              backgroundColor:
                i < filled
                  ? filled <= 2
                    ? colors.ink
                    : colors.inkSoft
                  : 'rgba(15,23,42,0.12)',
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cardPad: { padding: spacing.xl },
  primaryInner: { paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.white },
  secondary: {
    backgroundColor: 'rgba(29,78,216,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(29,78,216,0.25)',
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryLabel: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.brand },
  dangerOutline: {
    borderWidth: 2,
    borderColor: 'rgba(220,38,38,0.6)',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    paddingVertical: 15,
    alignItems: 'center',
  },
  dangerOutlineLabel: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.danger },
  backLink: { paddingVertical: 4, alignSelf: 'flex-start' },
  backLinkLabel: { fontFamily: fonts.sansSemi, fontSize: 12, color: colors.brand },
  pill: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillLabel: { fontFamily: fonts.sansSemi, fontSize: 12.5 },
  statCard: { padding: 14, borderRadius: 18, flex: 1 },
  statValue: { marginTop: 9, fontSize: 22, lineHeight: 24 },
  statUnit: { fontFamily: fonts.sans, fontSize: 12, color: colors.slate },
  stripContent: { gap: spacing.md, paddingRight: spacing.xl },
  stripCard: { width: 168, padding: 13, borderRadius: radius.md, borderWidth: 1 },
  stripTime: {
    fontFamily: fonts.monoSemi,
    fontSize: 10,
    color: colors.brand,
    letterSpacing: 0.6,
  },
  stripText: { ...type.small, color: colors.inkSoft, marginTop: 6, fontSize: 11.5 },
  ledger: { backgroundColor: colors.ledger, borderRadius: radius.md, padding: 14 },
  ledgerRow: { flexDirection: 'row', gap: 9, paddingVertical: 3, alignItems: 'center' },
  ledgerAt: { fontFamily: fonts.mono, fontSize: 10.5, color: 'rgba(255,255,255,0.45)' },
  ledgerCall: { flex: 1, fontFamily: fonts.mono, fontSize: 10.5, color: colors.ledgerText },
  ledgerMs: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.ledgerMs },
  ledgerEmpty: { fontFamily: fonts.mono, fontSize: 10.5, color: 'rgba(255,255,255,0.5)' },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 6, borderRadius: radius.pill },
});
