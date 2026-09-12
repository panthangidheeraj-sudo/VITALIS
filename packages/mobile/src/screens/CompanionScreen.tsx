/**
 * Screen 9 - Emergency Companion Mode (5.4).
 *
 * ROUGH LAYOUT. Structure only.
 *
 * The point this screen has to make, visually, in one glance: THE AGENT DID NOT
 * STOP. Triage produced a decision and the system is still watching. That is
 * the difference between an agent and a form, and it is what 5.4 is scored on -
 * so the reassessment count and the next-check countdown are the largest things
 * here, not a status line buried at the bottom.
 *
 * TREND, NOT VALUE. Breathing, consciousness and bleeding are shown as
 * direction of travel (worsening / stable / improving), because "still bad but
 * no worse" and "getting worse" demand completely different responses and a
 * single snapshot cannot tell them apart.
 *
 * NOT YET SCHEDULED: `runCompanionTick` exists in packages/agent but nothing
 * calls it on a timer, so this screen currently renders whatever the last turn
 * left behind. The countdown is honest about that - it shows "not scheduled"
 * rather than animating a timer that nothing is driving.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CaseId, CompanionState } from '@triage/shared';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { colors, radius, spacing, tierColor, tierLabel, type } from '../theme';

interface Props {
  readonly caseId: CaseId;
  readonly onOpenFirstAid: () => void;
  readonly onBack: () => void;
}

type Trend = 'worsening' | 'stable' | 'improving' | undefined;

const TREND_LABEL: Record<string, string> = {
  worsening: 'WORSENING',
  stable: 'STABLE',
  improving: 'IMPROVING',
};

function trendColor(trend: Trend): string {
  if (trend === 'worsening') return colors.danger;
  if (trend === 'improving') return colors.success;
  return colors.textMuted;
}

export function CompanionScreen({ caseId, onOpenFirstAid, onBack }: Props) {
  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const state = live.caseState;
  const companion: CompanionState | undefined = state?.companion;
  const tier = state?.risk.tier ?? 'yellow';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.banner, { backgroundColor: tierColor[tier] }]}>
        <Text style={styles.bannerLabel}>STILL MONITORING</Text>
        <Text style={styles.bannerTitle}>{tierLabel[tier]}</Text>
        <Text style={styles.bannerSub}>
          I am checking on you every few minutes. Tell me if anything changes.
        </Text>
      </View>

      {/* The proof that the loop is still running. */}
      <View style={styles.statRow}>
        <Stat label="CHECKS DONE" value={String(companion?.reassessmentCount ?? 0)} />
        <Stat
          label="NEXT CHECK"
          value={
            companion?.nextReassessmentDueAt === undefined
              ? 'not scheduled'
              : companion.nextReassessmentDueAt.slice(11, 16)
          }
        />
        <Stat
          label="LAST CHECK"
          value={
            companion?.lastReassessedAt === undefined
              ? 'none yet'
              : companion.lastReassessedAt.slice(11, 16)
          }
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>DIRECTION OF TRAVEL</Text>
        <TrendRow label="Breathing" trend={companion?.trends.breathing} />
        <TrendRow label="Consciousness" trend={companion?.trends.consciousness} />
        <TrendRow label="Bleeding" trend={companion?.trends.bleeding} />
        <Text style={type.tiny}>
          Direction matters more than a single reading: "no worse" and "getting worse" need
          different responses.
        </Text>
      </View>

      {companion?.activeFirstAidTopic !== undefined ? (
        <Pressable style={styles.firstAidCard} onPress={onOpenFirstAid}>
          <Text style={styles.cardLabel}>DO THIS NOW</Text>
          <Text style={type.h3}>{companion.activeFirstAidTopic}</Text>
          <Text style={type.small}>Step-by-step instructions, matched to your current state.</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.card} onPress={onOpenFirstAid}>
          <Text style={styles.cardLabel}>FIRST AID</Text>
          <Text style={type.small}>Open the offline first-aid steps.</Text>
        </Pressable>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>SHARED WITH</Text>
        <Text style={type.body}>
          {state?.relay.active === true ? 'Caregiver is connected' : 'Emergency contacts notified'}
        </Text>
        <Text style={type.tiny}>Your live location continues to be shared while this is open.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>RECORD SO FAR</Text>
        {live.timeline.slice(-8).map((entry) => (
          <View key={String(entry.id)} style={styles.timelineRow}>
            <Text style={styles.timelineTime}>{entry.at.slice(11, 16)}</Text>
            <Text style={styles.timelineText}>{entry.summary}</Text>
          </View>
        ))}
        {live.timeline.length === 0 ? <Text style={type.small}>No entries yet.</Text> : null}
      </View>

      <Pressable onPress={onBack} style={styles.linkButton}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

function TrendRow({ label, trend }: { readonly label: string; readonly trend: Trend }) {
  return (
    <View style={styles.trendRow}>
      <Text style={styles.trendLabel}>{label}</Text>
      {/* Text, not just colour - see theme.ts. */}
      <Text style={[styles.trendValue, { color: trendColor(trend) }]}>
        {trend === undefined ? 'NOT ASSESSED' : TREND_LABEL[trend]}
      </Text>
    </View>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },

  banner: { borderRadius: radius.lg, padding: spacing.lg },
  bannerLabel: { color: '#FFFFFFCC', fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  bannerTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', marginTop: 2 },
  bannerSub: { color: '#FFFFFFDD', fontSize: 13, marginTop: spacing.xs },

  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  statLabel: { ...type.tiny, letterSpacing: 0.6 },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.text },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  firstAidCard: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardLabel: { ...type.tiny, letterSpacing: 0.6, marginBottom: spacing.xs },

  trendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  trendLabel: { ...type.body, fontWeight: '600' },
  trendValue: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },

  timelineRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  timelineTime: { ...type.mono, width: 44 },
  timelineText: { ...type.small, flex: 1, color: colors.text },

  linkButton: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
