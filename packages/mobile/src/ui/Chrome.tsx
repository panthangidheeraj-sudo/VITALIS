/**
 * Screen chrome: the page wash every screen sits on, and the bottom tab bar.
 *
 * Redesigned bottom nav to match the reference UI: floating frosted-glass pill
 * with 4 items (Home, Assistant, Emergency, First Aid), Home selected state
 * uses a blue translucent capsule background.
 */

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
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
      {/* Every SCROLLING screen routed through here (the symptom-tag input on
          Emergency, the profile editor, the medicine scanner) gets keyboard-
          avoidance for free — `padding` on iOS resizes the content area
          itself; Android has no equivalent transform, so `height` shrinks the
          container instead (also needs `windowSoftInputMode: adjustResize`,
          set via app.json's `android.softwareKeyboardLayoutMode`, or Android
          never actually resizes the window for `height` to shrink against).
          Without this, the keyboard simply draws on top of whatever is behind
          it, which is what was hiding the input and the last few messages.

          SKIPPED when `scroll` is false: that is Assistant's own screen,
          which already wraps itself in `KeyboardAvoidingView` — nesting two
          of them here made the keyboard behavior worse, not better, since
          both were resizing the same space independently. */}
      {scroll ? (
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Body
            style={styles.fill}
            contentContainerStyle={styles.scrollPad}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </Body>
        </KeyboardAvoidingView>
      ) : (
        <Body style={styles.fill}>{children}</Body>
      )}
      {footer === undefined ? null : <View style={styles.footer}>{footer}</View>}
      {hideNav || onTab === undefined ? null : <BottomNav active={tab} onTab={onTab} />}
    </LinearGradient>
  );
}

/**
 * The floating tab pill — redesigned to match the reference image.
 *
 * Four tabs: Home, Assistant, Emergency, First Aid.
 * Selected item has a soft blue translucent capsule behind it.
 * Uses BlurView for genuine iOS-style glass effect.
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
        {/* Blur layer */}
        <BlurView intensity={30} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={styles.navTint} />
        {items.map((item) => {
          const on = active === item.id;
          const tint = on ? '#1769E8' : '#93A9CE';
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
                style={[styles.navLabel, { color: on ? '#1769E8' : '#93A9CE' }]}
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
      {/* iOS home indicator stub */}
      <View style={styles.homeIndicator} />
    </View>
  );
}

function NavIcon({ id, tint }: { readonly id: string; readonly tint: string }) {
  if (id === 'home') {
    return (
      <Svg width={19} height={17} viewBox="0 0 24 22" fill="none">
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
    // Plus/cross icon (matches reference: "+" symbol)
    return (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
        <Path d="M12 5v14M5 12h14" stroke={tint} strokeWidth={2.4} strokeLinecap="round" />
      </Svg>
    );
  }
  if (id === 'emergency') {
    // Heart with ECG line
    return (
      <Svg width={19} height={17} viewBox="0 0 24 21" fill="none">
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
  // First aid: circle with + 
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
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
  scrollPad: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 130 },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: 'rgba(247,251,255,0.86)',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },

  // Bottom nav
  navWrap: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    alignItems: 'center',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: 72,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.90)',
    paddingVertical: 8,
    paddingHorizontal: 4,
    overflow: 'hidden',
    // iOS shadow
    shadowColor: '#1a3255',
    shadowOpacity: 0.14,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  navTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.68)',
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderRadius: 26,
  },
  navItemOn: {
    backgroundColor: 'rgba(205,225,255,0.58)',
  },
  navIcon: { width: 24, height: 18, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontFamily: fonts.sansSemi, fontSize: 9.5, textAlign: 'center' },
  homeIndicator: {
    width: 134,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(20,39,68,0.20)',
    marginTop: 8,
  },
  wordmark: { fontFamily: 'InstrumentSerif_400Regular', color: colors.ink, letterSpacing: 0.2 },
});
