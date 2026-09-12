/**
 * Risk tier and confidence, shown as the two separate axes spec 2 calls for.
 *
 * They are rendered side by side deliberately. The headline idea of the whole
 * project is that "how bad is this" and "how much do I believe it" are
 * different questions - collapsing them into one badge would hide exactly the
 * case the system exists to catch: a LOW-risk reading that nobody should trust
 * yet. A confidence alert therefore gets its own visible banner rather than
 * quietly nudging a number.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { ConfidenceLevel, RiskTier } from '@triage/shared';
import { colors, radius, spacing, tierColor, tierLabel, tierSurface, type } from '../theme';

interface Props {
  readonly tier: RiskTier;
  readonly confidenceLevel: ConfidenceLevel;
  readonly confidenceScore: number;
  readonly alertActive: boolean;
  /** Set when the score came from the local fallback rather than the clinical engine. */
  readonly degradedNotice?: string | undefined;
}

export function RiskBadge({
  tier,
  confidenceLevel,
  confidenceScore,
  alertActive,
  degradedNotice,
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={[styles.axis, { backgroundColor: tierSurface[tier] }]}>
          <Text style={styles.axisLabel}>RISK</Text>
          <Text style={[styles.axisValue, { color: tierColor[tier] }]}>{tierLabel[tier]}</Text>
        </View>

        <View style={[styles.axis, styles.confidenceAxis]}>
          <Text style={styles.axisLabel}>INFORMATION CONFIDENCE</Text>
          <Text style={styles.axisValue}>
            {confidenceLevel.toUpperCase()}
            <Text style={styles.axisSub}> {Math.round(confidenceScore * 100)}%</Text>
          </Text>
        </View>
      </View>

      {alertActive ? (
        <View style={styles.alert}>
          <Text style={styles.alertTitle}>Confidence alert</Text>
          <Text style={styles.alertBody}>
            What you have told me conflicts with something else on record. I need to check a
            couple of things before deciding anything.
          </Text>
        </View>
      ) : null}

      {degradedNotice !== undefined ? (
        <View style={styles.degraded}>
          <Text style={styles.degradedTitle}>Clinical scoring degraded</Text>
          <Text style={styles.degradedBody}>{degradedNotice}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  axis: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confidenceAxis: { backgroundColor: colors.surface },
  axisLabel: { ...type.tiny, letterSpacing: 0.6, marginBottom: spacing.xs },
  axisValue: { fontSize: 17, fontWeight: '800', color: colors.text },
  axisSub: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  alert: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  alertTitle: { ...type.h3, color: '#7C2D12', marginBottom: 2 },
  alertBody: { fontSize: 14, color: '#7C2D12', lineHeight: 19 },
  degraded: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderLeftWidth: 4,
    borderLeftColor: colors.textFaint,
  },
  degradedTitle: { ...type.h3, marginBottom: 2 },
  degradedBody: { ...type.small, lineHeight: 18 },
});
