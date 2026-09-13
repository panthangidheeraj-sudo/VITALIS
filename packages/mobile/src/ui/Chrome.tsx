/**
 * Screen chrome: the page wash every screen sits on, and the bottom tab bar.
 *
 * In the design these live in the phone-frame mock that wraps all twelve
 * screens. On a real device the frame itself disappears — the phone IS the
 * frame — so what survives is the gradient wash, the scroll container, and the
 * floating nav pill.
 */

import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, fonts, pageWash, radius, shadow, spacing } from '../theme';

/** Which tab is lit. `none` is for screens that are not tabs at all. */
export type Tab = 'home' | 'assistant' | 'emergency' | 'firstaid' | 'none';

export function Screen({
  children,
  scroll = true,
  tab = 'none',
  onTab,
  /** Tracking hides the bar: it owns the whole screen until the case ends. */
  hideNav = false,
  footer,
}: {
  readonly children: ReactNode;
  readonly scroll?: boolean;
  readonly tab?: Tab;
  readonly onTab?: (tab: Exclude<Tab, 'none'>) => void;
  readonly hideNav?: boolean;
  /** Pinned above the nav bar — used for Cancel Alert, which must not scroll away. */
  readonly footer?: ReactNode;
}) {
  const Body = scroll ? ScrollView : View;
  return (
    <LinearGradient
      colors={pageWash.colors}
      start={pageWash.start}
      end={pageWash.end}
      style={styles.fill}
    >
      <Body
        style={styles.fill}
        {...(scroll
          ? {
              contentContainerStyle: styles.scrollPad,
              showsVerticalScrollIndicator: false,
              keyboardShouldPersistTaps: 'handled' as const,
            }
          : {})}
      >
        {children}
      </Body>
      {footer === undefined ? null : <View style={styles.footer}>{footer}</View>}
      {hideNav || onTab === undefined ? null : <BottomNav active={tab} onTab={onTab} />}
    </LinearGradient>
  );
}

/**
 * The floating tab pill.
 *
 * Four tabs, matching the design: Home, Assistant, Emergency, First Aid. The
 * icons are hand-drawn SVG rather than an icon font, because the emergency
 * glyph is specific — a heart with an ECG trace through it — and no icon set
 * has it.
 */
function BottomNav({
  active,
  onTab,
}: {
  readonly active: Tab;
  readonly onTab: (tab: Exclude<Tab, 'none'>) => void;
}) {
  const items: readonly { readonly id: Exclude<Tab, 'none'>; readonly label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'assistant', label: 'Assistant' },
    { id: 'emergency', label: 'Emergency' },
    { id: 'firstaid', label: 'First Aid' },
  ];

  return (
    <View style={styles.navWrap}>
      <View style={styles.navBar}>
        {items.map((item) => {
          const on = active === item.id;
          const tint = on ? colors.brand : '#B9C6E0';
          return (
            <Pressable
              key={item.id}
              onPress={() => onTab(item.id)}
              style={[styles.navItem, on ? styles.navItemOn : null]}
            >
              <View style={styles.navIcon}>
                <NavIcon id={item.id} tint={tint} />
              </View>
              <Text
                style={[styles.navLabel, { color: on ? colors.brand : '#93A9CE' }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function NavIcon({ id, tint }: { readonly id: string; readonly tint: string }) {
  if (id === 'home') {
    return (
      <Svg width={17} height={15} viewBox="0 0 24 22" fill="none">
        <Path d="M2 10.5L12 2L22 10.5" stroke={tint} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        <Path
          d="M4.5 9V19.5C4.5 20.05 4.95 20.5 5.5 20.5H18.5C19.05 20.5 19.5 20.05 19.5 19.5V9"
          stroke={tint}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M9.5 20.5V14.5C9.5 13.95 9.95 13.5 10.5 13.5H13.5C14.05 13.5 14.5 13.95 14.5 14.5V20.5"
          stroke={tint}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  if (id === 'assistant') {
    // The four-point spark, drawn as two crossed bars exactly as the design does.
    return (
      <Svg width={16} height={16} viewBox="0 0 14 14">
        <Path d="M6 0 H8 V14 H6 Z" fill={tint} />
        <Path d="M0 6 H14 V8 H0 Z" fill={tint} />
      </Svg>
    );
  }
  if (id === 'emergency') {
    return (
      <Svg width={17} height={15} viewBox="0 0 24 21" fill="none">
        <Path
          d="M12 20C12 20 2 14.2 2 7.5C2 4.5 4.3 2.5 7 2.5C9 2.5 10.7 3.7 12 5.5C13.3 3.7 15 2.5 17 2.5C19.7 2.5 22 4.5 22 7.5C22 14.2 12 20 12 20Z"
          fill={tint}
        />
        <Path
          d="M6 9.5H9L10.5 6.5L13 12.5L14.5 9.5H18"
          stroke="#fff"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    );
  }
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10.5} stroke={tint} strokeWidth={2} />
      <Path d="M12 7.5V16.5M7.5 12H16.5" stroke={tint} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

/** The Vitalis wordmark, in the serif display face. */
export function Wordmark({ size = 19 }: { readonly size?: number }) {
  return <Text style={[styles.wordmark, { fontSize: size, lineHeight: size * 1.1 }]}>Vitalis</Text>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollPad: { paddingHorizontal: spacing.xxl, paddingTop: spacing.md, paddingBottom: 120 },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: 'rgba(247,251,255,0.86)',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  navWrap: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 26,
    paddingVertical: 9,
    paddingHorizontal: 4,
    ...shadow('lift'),
  },
  /**
   * `flex: 1` on every item, not `justifyContent: 'space-around'` on the row.
   *
   * Yoga's default `flexShrink` is 0 — unlike web flexbox — so four fixed-width
   * pills whose combined intrinsic width (icon + label + padding) exceeds the
   * available row width do not shrink to fit; they overflow past the row's
   * right edge and whatever sits there clips them, which is what cut "Home"
   * down to "Hom" and "Assistant" down to "Assistan" on a narrower phone.
   * Four equal flex:1 columns can never sum to more than the row's width.
   */
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 2,
    borderRadius: radius.md,
  },
  navItemOn: { backgroundColor: 'rgba(29,78,216,0.12)' },
  navIcon: { width: 22, height: 16, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontFamily: fonts.sansSemi, fontSize: 9.5, textAlign: 'center' },
  wordmark: { fontFamily: fonts.serif, color: colors.ink, letterSpacing: 0.2 },
});
