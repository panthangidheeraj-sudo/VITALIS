/**
 * Companion Mode — the design's `isCompanion` screen.
 *
 * The agent does not stop when the decision is made (spec §5.4). This screen is
 * the visible half of that: how many reassessments have run, when the next one
 * is, and which direction the three tracked signs are moving.
 *
 * ---------------------------------------------------------------------------
 * DIRECTION, NOT READINGS — AND "NOT ASSESSED" IS A REAL ANSWER.
 *
 * The design's own line is kept because it is the point of the screen:
 * "Direction matters more than a single reading." A trend the agent has never
 * had evidence for renders as NOT ASSESSED in grey, not as STABLE. Defaulting
 * an unknown to "stable" would be the single most dangerous small lie available
 * here — it reads as "we checked and it is fine" when nobody checked at all.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CaseId } from '@triage/shared';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { clockTime } from '../state/caseView';
import { useProfile } from '../data/profileStore';
import { BackLink, Glass, Label } from '../ui/primitives';
import { colors, dangerWash, fonts, radius, shadow, spacing, tierColor, tierLabel, type } from '../theme';

interface Props {
  readonly caseId: CaseId;
  readonly onOpenFirstAid: () => void;
  readonly onBack: () => void;
}

const TREND_STYLE: Record<string, { readonly text: string; readonly color: string }> = {
  worsening: { text: 'WORSENING', color: colors.danger },
  stable: { text: 'STABLE', color: colors.slate },
  improving: { text: 'IMPROVING', color: colors.ok },
};

/** The grey fallback. Distinct from STABLE on purpose — see the header. */
const NOT_ASSESSED = { text: 'NOT ASSESSED', color: colors.faint };

export function CompanionScreen({ caseId, onOpenFirstAid, onBack }: Props) {
  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const state = live.caseState;
  const { profile } = useProfile();
  const [now, setNow] = useState(Date.now());

  // A countdown that does not count down is just a stale number. One tick a
  // second is enough and costs nothing on a screen with no other animation.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const companion = state?.companion;
  const tier = state?.risk.tier ?? 'red';
  const nextDue = companion?.nextReassessmentDueAt;
  const secondsLeft =
    nextDue === undefined ? undefined : Math.max(0, Math.round((new Date(nextDue).getTime() - now) / 1000));
  const primary = profile.contacts.find((c) => c.isPrimary);

  const trends: readonly { readonly label: string; readonly value: string | undefined }[] = [
    { label: 'Breathing', value: companion?.trends.breathing },
    { label: 'Consciousness', value: companion?.trends.consciousness },
    { label: 'Bleeding', value: companion?.trends.bleeding },
  ];

  return (
    <View style={styles.root}>
      <BackLink label="Tracking" onPress={onBack} />

      <LinearGradient
        colors={dangerWash.colors}
        start={dangerWash.start}
        end={dangerWash.end}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <View style={styles.pulse} />
          <Label color="rgba(255,255,255,0.85)">
            {companion?.active === true ? 'STILL MONITORING' : 'MONITORING NOT ACTIVE'}
          </Label>
        </View>
        <Text style={styles.heroTitle}>{tierLabel[tier]}</Text>
        <Text style={styles.heroBody}>
          {companion?.active === true
            ? `I check on you every ${Math.round((companion.intervalMs ?? 180000) / 60000)} minutes. Tell me the moment anything changes.`
            : 'Monitoring starts once a routing decision is confirmed.'}
        </Text>
      </LinearGradient>

      <View style={styles.row}>
        <Glass tone="strong" style={{ flex: 1.2 }} contentStyle={styles.bigStat}>
          <Label>CHECKS DONE</Label>
          <Text style={styles.bigNumber}>{companion?.reassessmentCount ?? 0}</Text>
          <Text style={[type.foot, { marginTop: 4 }]}>
            {companion?.lastReassessedAt === undefined
              ? 'none yet'
              : `last ${clockTime(companion.lastReassessedAt)}`}
          </Text>
        </Glass>
        <Glass tone="strong" style={{ flex: 1 }} contentStyle={styles.bigStat}>
          <Label>NEXT CHECK</Label>
          <Text style={styles.countdown}>
            {secondsLeft === undefined
              ? '—'
              : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
          </Text>
          <Text style={[type.foot, { marginTop: 6 }]}>
            {nextDue === undefined ? 'not scheduled' : `due ${clockTime(nextDue)}`}
          </Text>
        </Glass>
      </View>

      <Glass tone="blue" contentStyle={styles.card}>
        <Label style={{ marginBottom: 6 }}>DIRECTION OF TRAVEL</Label>
        {trends.map((trend) => {
          const shown = trend.value === undefined ? NOT_ASSESSED : TREND_STYLE[trend.value] ?? NOT_ASSESSED;
          return (
            <View key={trend.label} style={styles.trendRow}>
              <Text style={styles.trendLabel}>{trend.label}</Text>
              <Text style={[styles.trendValue, { color: shown.color }]}>{shown.text}</Text>
            </View>
          );
        })}
        <Text style={[type.foot, { marginTop: 10 }]}>
          {`Direction matters more than a single reading. “No worse” and “getting worse” need different responses.`}
        </Text>
      </Glass>

      <Pressable
        onPress={onOpenFirstAid}
        style={({ pressed }) => [styles.doNow, pressed ? { transform: [{ scale: 0.97 }] } : null]}
      >
        <Label color={colors.dangerDeep}>DO THIS NOW</Label>
        <Text style={styles.doNowTitle}>
          {companion?.activeFirstAidTopic ?? 'Sit upright and stop all exertion'}
        </Text>
        <Text style={[type.small, { color: colors.dangerInk, marginTop: 5 }]}>
          Step-by-step instructions, matched to your current state. Open now →
        </Text>
      </Pressable>

      <Glass tone="blue" contentStyle={styles.card}>
        <Label>RECEIVING YOUR LIVE LOCATION</Label>
        {state === undefined || state.notifications.length === 0 ? (
          <Text style={[type.small, { marginTop: 10 }]}>
            Nobody has been notified for this case.
          </Text>
        ) : (
          state.notifications.slice(0, 3).map((record, i) => (
            <View key={i} style={{ marginTop: 10 }}>
              <Text style={styles.contactName}>
                {primary?.name ?? 'Emergency contact'}
                {primary === undefined ? '' : ` · ${primary.relationship.toLowerCase()}`}
              </Text>
              <Text style={[type.small, { marginTop: 2, fontSize: 11 }]}>
                {/* `suppressed` is shown as what it is. A dry run that reads as
                    a delivered alert would let someone believe their family
                    knows when nobody has been told. */}
                {record.status === 'sent'
                  ? `${record.channel} alert delivered ${clockTime(record.sentAt)}`
                  : record.status === 'suppressed'
                    ? `${record.channel} alert composed but NOT sent — ${record.failureReason ?? 'sending is disabled'}`
                    : `${record.channel} alert ${record.status}`}
              </Text>
            </View>
          ))
        )}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  hero: { borderRadius: radius.xl, padding: 18, ...shadow('lift') },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.white },
  heroTitle: {
    fontFamily: fonts.sansBlack,
    fontSize: 25,
    lineHeight: 27,
    color: colors.white,
    marginTop: 11,
    letterSpacing: -0.4,
  },
  heroBody: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 5,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  bigStat: { padding: spacing.xl, borderRadius: radius.lg },
  bigNumber: {
    fontFamily: fonts.sansBlack,
    fontSize: 44,
    lineHeight: 46,
    color: colors.ink,
    marginTop: 10,
    letterSpacing: -1.5,
  },
  countdown: {
    fontFamily: fonts.sansBlack,
    fontSize: 26,
    lineHeight: 28,
    color: colors.brand,
    marginTop: 12,
    letterSpacing: -0.5,
  },
  card: { padding: spacing.xl, borderRadius: radius.lg },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15,23,42,0.07)',
  },
  trendLabel: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: colors.ink },
  trendValue: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 0.9 },
  doNow: {
    backgroundColor: colors.dangerWash,
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.28)',
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  doNowTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.ink, marginTop: 9 },
  contactName: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: colors.ink },
});
