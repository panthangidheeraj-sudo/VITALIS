/**
 * The Vitalis design system, transcribed from design/VitalisApp.dc.html.
 *
 * Every colour, size and radius here was read off the design rather than
 * invented, so that "does this match the design?" is a question about this one
 * file instead of about two hundred inline styles. When something had to change
 * for React Native, the change is stated at the point it happens.
 *
 * ---------------------------------------------------------------------------
 * THE GLASS, AND WHY IT IS NOT REAL BLUR
 *
 * The design leans on `backdrop-filter: blur(20px) saturate(1.4)` for almost
 * every surface. React Native has no such property; `expo-blur` is the literal
 * translation and it was deliberately not used. A typical screen here has
 * eight or more glass surfaces, and Android blur in Expo Go is expensive
 * enough to drop frames — on, among others, the screen holding a 3-second
 * press-and-hold gate, where a stutter reads as the hold not registering.
 *
 * What is kept instead is the part that actually carries the look: a
 * translucent near-white fill over the page's blue gradient wash, with a
 * brighter hairline border. Side by side with the browser the difference is
 * visible only where something high-contrast passes underneath, which in this
 * layout is nowhere.
 * ---------------------------------------------------------------------------
 */

import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import type { RiskTier } from '@triage/shared';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export const colors = {
  /** Vitalis blue. Actions, links, the agent's own voice. */
  brand: '#1D4ED8',
  brandDeep: '#1E3A8A',
  brandLift: '#2a5fe0',

  ink: '#0F172A',
  inkSoft: '#334155',
  inkMuted: '#475569',
  slate: '#64748B',
  /** The colour every mono micro-label uses. Distinct from `slate` on purpose. */
  label: '#7b8ca6',
  labelDim: '#8494ab',
  faint: '#94A3B8',

  surface: 'rgba(255,255,255,0.62)',
  surfaceStrong: 'rgba(255,255,255,0.72)',
  surfaceSoft: 'rgba(255,255,255,0.55)',
  /** The blue-tinted card used for data panels. */
  surfaceBlue: 'rgba(219,234,254,0.44)',
  hairline: 'rgba(255,255,255,0.88)',
  hairlineSoft: 'rgba(255,255,255,0.75)',
  divider: 'rgba(15,23,42,0.08)',

  /** The near-black panel the tool-call ledger sits on. */
  ledger: 'rgba(15,23,42,0.90)',
  ledgerText: 'rgba(255,255,255,0.86)',
  ledgerDim: 'rgba(255,255,255,0.55)',
  ledgerMs: '#7dd3a0',

  danger: '#DC2626',
  dangerDeep: '#991B1B',
  dangerInk: '#7f1d1d',
  dangerWash: 'rgba(254,226,226,0.72)',

  warn: '#D97706',
  warnDeep: '#92400e',
  warnInk: '#78350f',
  warnWash: 'rgba(254,243,199,0.80)',

  ok: '#15803D',
  okWash: 'rgba(21,128,61,0.12)',

  white: '#ffffff',
} as const;

/**
 * Tier colours.
 *
 * ORANGE IS NOT IN THE DESIGN. The design was drawn against a three-tier scale
 * and the risk scale gained a fourth tier (`orange`, consultation within 24h)
 * afterwards. Leaving it out was not an option — a tier with no colour renders
 * as whatever `undefined` does — and reusing yellow would collapse two
 * distinct clinical outcomes into one visual. `#EA580C` is the step between
 * the design's own `#D97706` and `#DC2626`.
 */
export const tierColor: Record<RiskTier, string> = {
  green: '#15803D',
  yellow: '#D97706',
  orange: '#EA580C',
  red: '#DC2626',
};

/** The washed-out version, for a tier-tinted card behind body text. */
export const tierSurface: Record<RiskTier, string> = {
  green: 'rgba(21,128,61,0.10)',
  yellow: 'rgba(217,119,6,0.10)',
  orange: 'rgba(234,88,12,0.10)',
  red: 'rgba(220,38,38,0.10)',
};

/** What each tier is called on screen. Short enough for the tier header. */
export const tierLabel: Record<RiskTier, string> = {
  green: 'LOW RISK',
  yellow: 'ELEVATED',
  orange: 'URGENT',
  red: 'CRITICAL',
};

/**
 * What the tier means as an ACTION, in the patient's terms.
 *
 * Carried over from the pre-design build and deliberately kept, because the
 * design's own sidebar makes the same point in prose: four colours are harder
 * to hold in your head than three, and under stress a colour alone stops being
 * self-explanatory. Every tier ships with the instruction it implies.
 */
export const tierAction: Record<RiskTier, string> = {
  green: 'Manage at home',
  yellow: 'See a doctor soon',
  orange: 'Be seen today',
  red: 'Emergency care now',
};

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * Font family names as `expo-font` registers them. Loaded in App.tsx; until
 * they resolve, `fontsReady` is false and everything falls back to the system
 * face. The fallback is legible, just not the design — which is the right
 * trade against a blank screen, since this app's first screen may be opened in
 * an emergency.
 */
export const fonts = {
  sans: 'PlusJakartaSans_400Regular',
  sansMedium: 'PlusJakartaSans_500Medium',
  sansSemi: 'PlusJakartaSans_600SemiBold',
  sansBold: 'PlusJakartaSans_700Bold',
  sansBlack: 'PlusJakartaSans_800ExtraBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemi: 'IBMPlexMono_600SemiBold',
  monoBold: 'IBMPlexMono_700Bold',
  /** The display face. Used for the wordmark and the assistant's greeting. */
  serif: 'InstrumentSerif_400Regular',
} as const;

/**
 * The type scale, lifted from the design's `font:` shorthands.
 *
 * `letterSpacing` on the mono labels is the single most identifying feature of
 * this design — `.12em` at 9.5px is 1.14px — and dropping it makes every
 * screen look generic even when the colours are right.
 */
export const type = StyleSheet.create({
  /** Screen title. `font:800 23-24px` */
  h1: { fontFamily: fonts.sansBlack, fontSize: 23, lineHeight: 27, color: colors.ink, letterSpacing: -0.5 },
  /** Card headline. `font:800 21-22px` */
  h2: { fontFamily: fonts.sansBlack, fontSize: 21, lineHeight: 24, color: colors.ink, letterSpacing: -0.3 },
  /** Section heading. `font:700 13px` */
  h3: { fontFamily: fonts.sansBold, fontSize: 13, lineHeight: 17, color: colors.ink },
  /** The agent's question. `font:600 17px/1.35` */
  question: { fontFamily: fonts.sansSemi, fontSize: 17, lineHeight: 23, color: colors.ink },
  /** Body. `font:400 12.5px/1.55` */
  body: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 19, color: colors.inkMuted },
  bodyInk: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: colors.inkSoft },
  /** Small print. `font:400 11.5px/1.5` */
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17, color: colors.slate },
  /** Footnote, the quietest text on any screen. `font:400 10.5px/1.5` */
  foot: { fontFamily: fonts.sans, fontSize: 10.5, lineHeight: 16, color: colors.labelDim },
  /** The micro-label above every value. `font:600 9.5px, letter-spacing .12em` */
  label: {
    fontFamily: fonts.monoSemi,
    fontSize: 9.5,
    lineHeight: 11,
    color: colors.label,
    letterSpacing: 1.14,
  },
  /** A big number. `font:800 25px` */
  metric: { fontFamily: fonts.sansBlack, fontSize: 25, lineHeight: 25, color: colors.ink, letterSpacing: -0.5 },
  /** Monospace body, for ledger rows and coordinates. */
  mono: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 17, color: colors.inkSoft },
  /** The wordmark and the assistant greeting. */
  serif: { fontFamily: fonts.serif, fontSize: 19, lineHeight: 19, color: colors.ink, letterSpacing: 0.2 },
  serifDisplay: { fontFamily: fonts.serif, fontSize: 29, lineHeight: 33, color: colors.ink, letterSpacing: 0.2 },
});

// ---------------------------------------------------------------------------
// Space, shape, shadow
// ---------------------------------------------------------------------------

export const spacing = { xs: 4, sm: 7, md: 10, lg: 12, xl: 16, xxl: 20, xxxl: 22 } as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 22,
  xxl: 24,
  pill: 999,
} as const;

/**
 * Shadows. iOS takes the offset/opacity/radius triple; Android only has
 * `elevation`, which cannot tint — so the design's blue-tinted shadows read as
 * neutral grey there. Accepted rather than faked with a stack of nested views.
 */
export function shadow(level: 'card' | 'lift' | 'hero'): ViewStyle {
  const spec = {
    card: { o: 0.07, r: 24, y: 8, e: 3 },
    lift: { o: 0.1, r: 30, y: 10, e: 6 },
    hero: { o: 0.22, r: 40, y: 16, e: 12 },
  }[level];
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#102a54',
      shadowOpacity: spec.o,
      shadowRadius: spec.r,
      shadowOffset: { width: 0, height: spec.y },
    },
    default: { elevation: spec.e },
  }) as ViewStyle;
}

export type GlassTone = 'plain' | 'blue' | 'strong';

/**
 * The standard glass surface, kept for the handful of places that genuinely
 * cannot host a native `<BlurView>` (a `transform`-animated card in the
 * first-aid stack, a `Pressable`'s style function). Everywhere else, use the
 * `<Glass>` component from `ui/primitives.tsx` instead — this alone cannot
 * produce a backdrop blur, because that is not a style property in React
 * Native, only an actual layered native view can do it.
 */
export function glass(tone: GlassTone = 'plain'): ViewStyle {
  return {
    backgroundColor:
      tone === 'blue' ? colors.surfaceBlue : tone === 'strong' ? colors.surfaceStrong : colors.surface,
    borderWidth: 1,
    borderColor: tone === 'blue' ? colors.hairlineSoft : colors.hairline,
    borderRadius: radius.lg,
    ...shadow('card'),
  };
}

/**
 * The outer, unclipped shell — carries the shadow only.
 *
 * Split from the border/fill deliberately: iOS shadows require
 * `overflow: 'visible'` on the element that casts them, while the blur
 * beneath needs `overflow: 'hidden'` to respect the rounded corners. One View
 * cannot be both, so `<Glass>` nests a clipped inner view inside this one.
 */
export function glassShadow(
  cornerRadius: number = radius.lg,
  level: 'card' | 'lift' | 'hero' = 'card',
): ViewStyle {
  return { borderRadius: cornerRadius, ...shadow(level) };
}

/** The clipped shell: border, radius, and the overflow that crops the blur. */
export function glassClip(tone: GlassTone = 'plain', cornerRadius: number = radius.lg): ViewStyle {
  return {
    borderRadius: cornerRadius,
    borderWidth: 1,
    borderColor: tone === 'blue' ? colors.hairlineSoft : colors.hairline,
    overflow: 'hidden',
  };
}

/**
 * The tint layered over the blur.
 *
 * Deliberately a LOWER alpha than the flat `glass()` fill — real blur now
 * supplies the softening that the higher alpha used to fake, and a tint this
 * light is what keeps content behind the card actually readable through it,
 * which is the entire point of asking for glassmorphism over a flat card.
 */
export function glassTint(tone: GlassTone = 'plain'): ViewStyle {
  return {
    backgroundColor:
      tone === 'blue'
        ? 'rgba(219,234,254,0.28)'
        : tone === 'strong'
          ? 'rgba(255,255,255,0.38)'
          : 'rgba(255,255,255,0.30)',
  };
}

// ---------------------------------------------------------------------------
// The page wash
// ---------------------------------------------------------------------------

/**
 * The three radial gradients behind every screen.
 *
 * React Native has no radial gradient, and `expo-linear-gradient` is linear
 * only. Rather than ship a stack of blurred circles to fake three radials,
 * this is a single diagonal blue-tinted linear gradient in the same family of
 * colours. It reads as the same page; it is not pixel-identical, and it is the
 * largest single visual departure in this port.
 */
/**
 * Gradient stop lists are typed as TUPLES, not arrays.
 *
 * `expo-linear-gradient` requires at least two stops and expresses that in its
 * prop type (`readonly [ColorValue, ColorValue, ...ColorValue[]]`). Declaring
 * these as tuples means a one-colour gradient is a compile error here rather
 * than a silently transparent band at the call site.
 */
type Stops = readonly [string, string, ...string[]];

export const pageWash: { colors: Stops; start: { x: number; y: number }; end: { x: number; y: number } } = {
  colors: ['#f2f7fd', '#e4edfa', '#d9e6f7'],
  start: { x: 0.1, y: 0 },
  end: { x: 0.9, y: 1 },
};

/** The red hero band used by tracking, handoff and companion. */
export const dangerWash: { colors: Stops; start: { x: number; y: number }; end: { x: number; y: number } } = {
  colors: ['rgba(224,54,54,0.92)', 'rgba(184,27,27,0.95)'],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

/** The blue gradient on every primary button. */
export const brandWash: { colors: Stops; start: { x: number; y: number }; end: { x: number; y: number } } = {
  colors: ['#2f63e3', '#1D4ED8'],
  start: { x: 0.1, y: 0 },
  end: { x: 0.9, y: 1 },
};

/** Escalation's calmer blue. Deliberately NOT the danger gradient (§1). */
export const escalateWash: { colors: Stops; start: { x: number; y: number }; end: { x: number; y: number } } = {
  colors: ['rgba(42,95,224,0.95)', 'rgba(21,50,143,0.97)'],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Applies the mono label treatment at an arbitrary colour. */
export function labelStyle(color: string): TextStyle {
  return { ...type.label, color };
}
