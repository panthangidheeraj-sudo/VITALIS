/**
 * Screen 7 - Doctor Handoff Timeline (5.3).
 *
 * ROUGH LAYOUT. Structure only - but the INFORMATION ORDER here is not
 * placeholder, because it is what the spec judges: a clinician has to read this
 * in seconds, so it opens with severity, elapsed time and the classic-
 * presentation flag, and the timeline comes last.
 *
 * Every clinical number on this screen is read from `deriveClinicalFields`,
 * whose only input is the `RiskAssessment` from the scoring engine. Nothing on
 * this screen accepts a severity from anywhere else, and the narrative fields a
 * model may write carry no numbers at all. That is the 5.3 requirement that
 * severity "trace back to the scoring engine, not be freeform-generated".
 *
 * The degradation line and the disclaimer are rendered unconditionally when
 * present. A handoff card that hides which engine produced its number is worse
 * than no card.
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CaseId, CaseState, TimelineEntry } from '@triage/shared';
import { HANDOFF_DISCLAIMER, deriveClinicalFields } from '@triage/shared';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { DEMO_EMERGENCY_CARD } from '../data/demoProfile';
import { colors, radius, spacing, tierColor, tierLabel, type } from '../theme';

interface Props {
  readonly caseId: CaseId;
  readonly onBack: () => void;
}

export function HandoffScreen({ caseId, onBack }: Props) {
  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const state = live.caseState;

  if (state === undefined) {
    return (
      <View style={styles.empty}>
        <Text style={type.h3}>Preparing handoff summary...</Text>
        <Text style={type.small}>Waiting for case data.</Text>
      </View>
    );
  }

  const derived = deriveClinicalFields(state.risk);
  const quotes = state.evidence
    .map((e) => e.rawText)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .slice(0, 4);
  const onset = state.evidence.find((e) => e.onsetAt !== undefined)?.onsetAt;
  const elapsed = onset === undefined ? undefined : minutesBetween(onset, state.updatedAt);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Urgency banner. Red gets the full-bleed treatment (9). */}
      <View style={[styles.banner, { backgroundColor: tierColor[derived.riskTier] }]}>
        <Text style={styles.bannerLabel}>CLINICAL HANDOFF</Text>
        <Text style={styles.bannerTitle}>{tierLabel[derived.riskTier]}</Text>
        <Text style={styles.bannerSub}>{derived.triageLevel.replace(/_/g, ' ')}</Text>
      </View>

      {/* The three numbers a clinician reaches for first. */}
      <View style={styles.statRow}>
        <Stat label="SEVERITY" value={`${derived.severityOutOfTen}/10`} />
        <Stat label="ELAPSED" value={elapsed === undefined ? 'unknown' : `${elapsed} min`} />
        <Stat label="CONFIDENCE" value={state.confidence.level.toUpperCase()} />
      </View>

      {derived.classicPresentation ? (
        <View style={styles.flagCard}>
          <Text style={styles.flagTitle}>CLASSIC PRESENTATION</Text>
          <Text style={type.small}>{derived.classicPresentationBasis.join(' + ')}</Text>
          <Text style={type.tiny}>Flagged by the scoring engine, not by a language model.</Text>
        </View>
      ) : null}

      <Card label="CHIEF COMPLAINT">
        <Text style={type.h3}>{chiefComplaint(state)}</Text>
        {onset !== undefined ? (
          <Text style={type.small}>Onset {onset.slice(11, 16)}</Text>
        ) : (
          <Text style={type.small}>Onset time not established</Text>
        )}
      </Card>

      {/* Verbatim, never paraphrased (5.3). */}
      <Card label="PATIENT'S OWN WORDS">
        {quotes.length === 0 ? (
          <Text style={type.small}>No free-text statements recorded.</Text>
        ) : (
          quotes.map((quote, i) => (
            <Text key={i} style={styles.quote}>
              "{quote}"
            </Text>
          ))
        )}
        <Text style={type.tiny}>Language: {state.language.toUpperCase()}</Text>
      </Card>

      <Card label="ALLERGIES / MEDICATIONS">
        <Text style={styles.alertText}>
          {DEMO_EMERGENCY_CARD.allergies.join(', ') || 'None reported'}
        </Text>
        <Text style={type.small}>
          {DEMO_EMERGENCY_CARD.medications.map((m) => m.normalizedName ?? m.reportedName).join(', ')}
        </Text>
        <Text style={type.tiny}>Medication names normalised via RxNorm. Interactions not checked.</Text>
      </Card>

      {state.confidence.contradictions.filter((c) => c.resolvedAt === undefined).length > 0 ? (
        <View style={styles.warnCard}>
          <Text style={styles.flagTitle}>UNRESOLVED CONTRADICTIONS</Text>
          {state.confidence.contradictions
            .filter((c) => c.resolvedAt === undefined)
            .map((c, i) => (
              <Text key={i} style={type.small}>
                {c.detail}
              </Text>
            ))}
          <Text style={type.tiny}>Re-verify these directly with the patient.</Text>
        </View>
      ) : null}

      <Card label="TIMELINE">
        {live.timeline.length === 0 ? (
          <Text style={type.small}>No entries yet.</Text>
        ) : (
          live.timeline.map((entry: TimelineEntry) => (
            <View key={String(entry.id)} style={styles.timelineRow}>
              <Text style={styles.timelineTime}>{entry.at.slice(11, 16)}</Text>
              <Text style={styles.timelineText}>{entry.summary}</Text>
            </View>
          ))
        )}
      </Card>

      <Card label="CODING">
        <Text style={type.body}>ICD-11 code pending</Text>
        <Text style={type.tiny}>
          Codes the category the scoring engine derived. The system does not diagnose.
        </Text>
      </Card>

      {/* Never hidden: which engine produced the number above. */}
      {derived.scoringDegradedReason !== undefined ? (
        <View style={styles.degradedCard}>
          <Text style={styles.flagTitle}>SCORING SOURCE: {derived.scoringSource.toUpperCase()}</Text>
          <Text style={type.small}>{derived.scoringDegradedReason}</Text>
        </View>
      ) : null}

      <Text style={styles.disclaimer}>{HANDOFF_DISCLAIMER}</Text>

      <Text style={styles.linkText} onPress={onBack}>
        Back
      </Text>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

function chiefComplaint(state: CaseState): string {
  const first = state.evidence.find((e) => e.source === 'initial_complaint') ?? state.evidence[0];
  return first?.commonName ?? first?.name ?? 'Not yet established';
}

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Card({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },

  banner: { borderRadius: radius.lg, padding: spacing.lg },
  bannerLabel: { color: '#FFFFFFCC', fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  bannerTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', marginTop: 2 },
  bannerSub: { color: '#FFFFFFDD', fontSize: 13, textTransform: 'capitalize' },

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
  cardLabel: { ...type.tiny, letterSpacing: 0.6, marginBottom: spacing.xs },

  flagCard: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 2,
  },
  warnCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 2,
  },
  degradedCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 2,
  },
  flagTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.text },

  quote: { ...type.body, fontStyle: 'italic', marginVertical: 2 },
  alertText: { ...type.body, fontWeight: '700', color: colors.danger },

  timelineRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  timelineTime: { ...type.mono, width: 44 },
  timelineText: { ...type.small, flex: 1, color: colors.text },

  disclaimer: { ...type.tiny, lineHeight: 16, marginTop: spacing.sm },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600', textAlign: 'center', paddingVertical: spacing.md },
});
