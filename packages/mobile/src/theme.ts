/**
 * Visual tokens.
 *
 * Risk tier is the one thing on screen that must never be ambiguous, so tiers
 * get saturated, high-contrast colours and everything else stays muted. Colour
 * alone is never the only signal — every tier is also labelled in text, since
 * red/green is the most common form of colour blindness and this is not a
 * screen where "which one was the bad one?" is acceptable.
 */

import type { RiskTier } from '@triage/shared';

export const colors = {
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0F172A',
  textMuted: '#64748B',
  textFaint: '#94A3B8',

  primary: '#1D4ED8',
  primaryDark: '#1E3A8A',

  danger: '#DC2626',
  dangerDark: '#991B1B',
  dangerSoft: '#FEE2E2',

  warning: '#D97706',
  warningSoft: '#FEF3C7',

  // Orange sits between warning and danger and must be distinguishable from
  // BOTH at a glance, in sunlight, on a cheap screen. #EA580C is far enough
  // from #D97706 (yellow) and #DC2626 (red) in hue and lightness to survive
  // that; a mid-point that merely "looks orange" next to them would not.
  urgent: '#EA580C',
  urgentSoft: '#FFEDD5',

  success: '#15803D',
  successSoft: '#DCFCE7',
} as const;

export const tierColor: Record<RiskTier, string> = {
  green: colors.success,
  yellow: colors.warning,
  orange: colors.urgent,
  red: colors.danger,
};

export const tierSurface: Record<RiskTier, string> = {
  green: colors.successSoft,
  yellow: colors.warningSoft,
  orange: colors.urgentSoft,
  red: colors.dangerSoft,
};

/** Text label for every tier — the non-colour channel. */
export const tierLabel: Record<RiskTier, string> = {
  green: 'LOW RISK',
  yellow: 'ELEVATED',
  orange: 'URGENT',
  red: 'CRITICAL',
};

/**
 * What the tier means as an ACTION, in the patient's terms. Four colours are
 * harder to hold in your head than three, and under stress a colour alone
 * stops being self-explanatory - so every tier ships with the instruction it
 * implies, not just a severity word.
 */
export const tierAction: Record<RiskTier, string> = {
  green: 'Manage at home',
  yellow: 'See a doctor soon',
  orange: 'Be seen today',
  red: 'Emergency care now',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const type = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  h3: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.textMuted },
  tiny: { fontSize: 11, color: colors.textFaint },
  mono: { fontSize: 12, fontFamily: 'monospace' as const, color: colors.textMuted },
};
