/**
 * The doctor handoff card — the design's `isHandoff` screen.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE SCREEN A CLINICIAN READS, SO IT IS THE STRICTEST ONE.
 *
 * Two rules govern everything on it, both from spec §7:
 *
 *   FACT AND INFERENCE STAY SEPARATE. The patient's own words are quoted
 *   verbatim, in their own language, never cleaned up or paraphrased. What the
 *   agent CONCLUDED sits in different cards with different styling. A clinician
 *   must always be able to tell which is which at a glance.
 *
 *   SEVERITY TRACES TO THE ENGINE BY CONSTRUCTION. Every clinical number comes
 *   from `deriveClinicalFields` over `state.risk`, which no model can write to.
 *   The SCORING SOURCE panel at the bottom names the engine that actually ran.
 *
 * The design's version of that panel reads `engine: infermedica /triage`. This
 * system does not call Infermedica — the tier comes from the local
 * deterministic rule engine — so the panel reads `risk.source` instead. A
 * handoff card that names the wrong vendor is a clinical document with a
 * falsehood in it.
 * ---------------------------------------------------------------------------
 */

import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CaseId, CaseState } from '@triage/shared';
import { HANDOFF_DISCLAIMER, deriveClinicalFields } from '@triage/shared';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { useProfile } from '../data/profileStore';
import { clockTime } from '../state/caseView';
import { BackLink, Glass, Label, NoticeCard, Stat, TimelineStrip } from '../ui/primitives';
import { PopIn } from '../ui/motion';
import { colors, fonts, radius, shadow, spacing, tierColor, tierLabel, type } from '../theme';

interface Props {
  readonly caseId: CaseId;
  readonly onBack: () => void;
}

export function HandoffScreen({ caseId, onBack }: Props) {
  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const state = live.caseState;
  const { profile } = useProfile();

  if (state === undefined) {
    return (
      <View style={styles.empty}>
        <BackLink label="Tracking" onPress={onBack} />
        <Text style={[type.h3, { marginTop: spacing.xl }]}>Preparing handoff summary…</Text>
        <Text style={type.small}>Waiting for case data.</Text>
      </View>
    );
  }

  const derived = deriveClinicalFields(state.risk);
  const quotes = state.evidence
    .filter((e) => typeof e.rawText === 'string' && e.rawText.length > 0)
    .slice(0, 4);
  const onset = state.evidence.find((e) => e.onsetAt !== undefined)?.onsetAt;
  const elapsed = onset === undefined ? undefined : minutesBetween(onset, state.updatedAt);
  const unresolved = state.confidence.contradictions.filter((c) => c.resolvedAt === undefined);
  const timeline = live.timeline.map((e) => ({ at: clockTime(e.at), text: e.summary }));

  return (
    <View style={styles.root}>
      <BackLink label="Tracking" onPress={onBack} />

      <PopIn>
        <LinearGradient
          colors={[tierColor[derived.riskTier], shade(tierColor[derived.riskTier])]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Label color="rgba(255,255,255,0.8)">CLINICAL HANDOFF</Label>
          <Text style={styles.heroTitle}>{tierLabel[derived.riskTier]}</Text>
          <Text style={styles.heroSub}>
            {`${derived.triageLevel.replace(/_/g, ' ')} · ${profile.displayName.trim().length > 0 ? profile.displayName : 'Patient'}, ${
              state.demographics.ageYears
            }, ${state.demographics.sex}`}
          </Text>
        </LinearGradient>
      </PopIn>

      <View style={styles.statRow}>
        <Stat label="SEVERITY" value={derived.severityOutOfTen} unit="/10" />
        <Stat label="ELAPSED" value={elapsed ?? '—'} unit={elapsed === undefined ? undefined : ' min'} />
        <Stat
          label="CONFIDENCE"
          value={state.confidence.level.toUpperCase()}
          valueStyle={styles.statWord}
        />
      </View>

      {derived.classicPresentation ? (
        <NoticeCard accent={colors.danger} background={colors.dangerWash} border="rgba(220,38,38,0.28)">
          <Label color={colors.dangerDeep}>CLASSIC PRESENTATION</Label>
          <Text style={styles.classicText}>{derived.classicPresentationBasis.join(' + ')}</Text>
          <Text style={[type.foot, { color: colors.dangerInk, marginTop: 6 }]}>
            Flagged by the rule-based scoring engine, not by a language model.
          </Text>
        </NoticeCard>
      ) : null}

      <Glass tone="blue" contentStyle={styles.card}>
        <Label>CHIEF COMPLAINT</Label>
        <Text style={styles.chief}>{chiefComplaint(state)}</Text>
        <Text style={[type.small, { marginTop: 3 }]}>
          {onset === undefined ? 'Onset time not established' : `Onset ${clockTime(onset)}`}
          {/* The live ICD-11 lookup is wired on the server but is not yet
              threaded onto the case document, so this states that rather than
              printing a code nobody looked up. */}
          {' · ICD-11 '}
          <Text style={styles.code}>not yet coded</Text>
        </Text>
      </Glass>

      {/* Verbatim. Never paraphrased, never tidied, never translated (§7). */}
      <Glass tone="blue" contentStyle={styles.card}>
        <Label style={{ marginBottom: 11 }}>{`PATIENT'S OWN WORDS · VERBATIM`}</Label>
        {quotes.length === 0 ? (
          <Text style={type.small}>No free-text statements recorded.</Text>
        ) : (
          quotes.map((item, i) => (
            <View key={String(item.id) || i} style={styles.quoteBlock}>
              <Text style={styles.quoteText}>{`“${item.rawText ?? ''}”`}</Text>
              <Text style={styles.quoteMeta}>
                {`${clockTime(item.observedAt)} · ${item.source === 'caregiver_report' ? 'caregiver' : 'patient'}, ${state.language.toUpperCase()}`}
              </Text>
            </View>
          ))
        )}
        <Text style={[type.foot, { marginTop: 4 }]}>
          {`Language: ${state.language.toUpperCase()} · never paraphrased or cleaned up.`}
        </Text>
      </Glass>

      <Glass tone="blue" contentStyle={styles.card}>
        <Label>ALLERGIES</Label>
        <Text style={styles.allergies}>
          {profile.allergies.join(' · ') || 'None reported'}
        </Text>

        <Label style={{ marginTop: 15 }}>MEDICATIONS</Label>
        <Text style={styles.meds}>{profile.medications.join(' · ') || 'None reported'}</Text>
        <Text style={[type.foot, { marginTop: 6 }]}>
          As entered on the profile. Interaction checking is NOT available in this system — the
          RxNav interaction endpoint was retired in January 2024.
        </Text>

        <Label style={{ marginTop: 15 }}>CHRONIC CONDITIONS</Label>
        <Text style={styles.meds}>
          {profile.chronicConditions.join(' · ') || 'None reported'}
        </Text>
      </Glass>

      {unresolved.length > 0 ? (
        <NoticeCard accent={colors.warn} background={colors.warnWash} border="rgba(217,119,6,0.32)">
          <Label color={colors.warnDeep}>{`UNRESOLVED CONTRADICTION · ${unresolved.length}`}</Label>
          {unresolved.map((c, i) => (
            <Text key={i} style={[type.body, { color: colors.warnInk, marginTop: 7 }]}>
              {c.detail}
            </Text>
          ))}
          <Text style={[type.foot, { color: colors.warnInk, marginTop: 7 }]}>
            Not settled. Re-verify directly with the patient before acting on it.
          </Text>
        </NoticeCard>
      ) : null}

      <Glass tone="blue" contentStyle={[styles.card, { paddingRight: 0 }]}>
        <Label style={{ marginBottom: 11 }}>CASE TIMELINE</Label>
        {timeline.length === 0 ? (
          <Text style={type.small}>No entries yet.</Text>
        ) : (
          <TimelineStrip entries={timeline} activeIndex={timeline.length - 1} />
        )}
      </Glass>

      {/* The provenance panel. Reads the engine that ACTUALLY ran. Kept solid
          and dark, not glass — it is a terminal/log surface by design (see
          `ui/primitives.tsx`'s LedgerPanel), and a frosted log reads wrong. */}
      <View style={styles.sourcePanel}>
        <Label color={colors.ledgerDim}>SCORING SOURCE</Label>
        <Text style={styles.sourceText}>
          {`engine: ${derived.scoringSource}\n`}
          {`level: ${derived.triageLevel} → ${tierLabel[derived.riskTier]}\n`}
          {'model contribution: none (no schema field exists)'}
        </Text>
        {derived.scoringDegradedReason === undefined ? null : (
          <Text style={[styles.sourceText, { color: '#fbbf24' }]}>
            {`degraded: ${derived.scoringDegradedReason}`}
          </Text>
        )}
        <Text style={styles.disclaimer}>{HANDOFF_DISCLAIMER}</Text>
      </View>
    </View>
  );
}

function chiefComplaint(state: CaseState): string {
  const first = state.evidence.find((e) => e.rawText !== undefined && e.rawText.length > 0);
  if (first !== undefined) return first.commonName ?? first.name;
  return state.risk.rootCause?.replace(/^red_flag:/, '') ?? 'Not yet established';
}

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
}

/**
 * A slightly darker companion for the hero gradient.
 *
 * The tier palette is a single colour per tier, and a flat band looks
 * noticeably cheaper than the design's gradient. Rather than add four more
 * hand-picked colours nobody would keep in sync, this darkens the one that
 * already exists.
 */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const dim = (v: number) => Math.max(0, Math.round(v * 0.78));
  const r = dim((n >> 16) & 255);
  const g = dim((n >> 8) & 255);
  const b = dim(n & 255);
  return `rgb(${r},${g},${b})`;
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  empty: { paddingVertical: spacing.xxl, gap: spacing.sm },
  hero: { borderRadius: radius.xl, padding: 18, ...shadow('lift') },
  heroTitle: {
    fontFamily: fonts.sansBlack,
    fontSize: 26,
    lineHeight: 28,
    color: colors.white,
    marginTop: 10,
    letterSpacing: -0.4,
  },
  heroSub: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 5,
  },
  statRow: { flexDirection: 'row', gap: 9 },
  statWord: { fontSize: 15, lineHeight: 19 },
  card: { padding: spacing.xl, borderRadius: radius.lg },
  classicText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink,
    marginTop: 8,
  },
  chief: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.ink, marginTop: 9 },
  code: { fontFamily: fonts.mono, color: colors.inkSoft },
  quoteBlock: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(29,78,216,0.35)',
    paddingLeft: 11,
    marginBottom: 9,
  },
  quoteText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: colors.ink },
  quoteMeta: { fontFamily: fonts.monoMedium, fontSize: 10, color: colors.labelDim, marginTop: 4 },
  allergies: {
    fontFamily: fonts.sansBlack,
    fontSize: 17,
    color: colors.dangerDeep,
    marginTop: 8,
  },
  meds: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 21, color: colors.ink, marginTop: 7 },
  sourcePanel: { backgroundColor: colors.ledger, borderRadius: radius.md, padding: 14 },
  sourceText: {
    fontFamily: fonts.monoMedium,
    fontSize: 11.5,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.88)',
    marginTop: 8,
  },
  disclaimer: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 9,
  },
});
