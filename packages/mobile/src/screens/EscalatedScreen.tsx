/**
 * Escalated to a human — the design's `isEscalated` screen.
 *
 * ---------------------------------------------------------------------------
 * THIS IS AN OUTCOME, NOT A FAILURE, AND THE VISUAL DESIGN CARRIES THAT.
 *
 * The design makes one decision here that is worth naming: the hero band is
 * BLUE, not red. Every other high-acuity surface in the app is red, and
 * escalation deliberately is not — because "I will not guess" is the system
 * working exactly as §1 specifies, and dressing it in the same colour as an
 * emergency would read as the app having broken down at the worst moment.
 *
 * The label `OUTCOME 6 OF 6 · DELIBERATE` does the same job in words. It is
 * kept verbatim from the design.
 * ---------------------------------------------------------------------------
 *
 * Ambulance dispatch stays reachable from this screen. Someone told "a human
 * will call you" who then deteriorates must not have to navigate backwards to
 * find help, so the route out is on the screen rather than behind the back
 * button.
 */

import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CaseId } from '@triage/shared';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { clockTime } from '../state/caseView';
import { useProfile } from '../data/profileStore';
import { BackLink, DangerOutlineButton, Glass, Label } from '../ui/primitives';
import { PopIn } from '../ui/motion';
import { colors, escalateWash, fonts, radius, shadow, spacing, type } from '../theme';

interface Props {
  readonly caseId: CaseId;
  readonly onBack: () => void;
  readonly onRequestAmbulance: () => void;
}

/** The reasons §1 allows, in the patient's language rather than the enum's. */
const REASON_TEXT: Record<string, string> = {
  unresolved_contradiction_high_risk:
    'Two accounts of what is happening disagree and I could not settle them. On a case scoring this high I will not guess.',
  confidence_too_low_to_route:
    'I do not have enough that I am sure of to recommend an action, and guessing on a case like this is not something I will do.',
  clinical_scoring_unavailable:
    'The clinical scoring engine is unavailable, so I cannot produce a tier I would stand behind.',
  patient_unresponsive: 'You stopped responding and I could not confirm you were all right.',
  explicit_user_request: 'You asked for a person, so I stopped and handed this over.',
  repeated_tool_failure:
    'Several tools I depend on failed in a row. Rather than work from partial information, I handed this to someone who can ask you directly.',
};

export function EscalatedScreen({ caseId, onBack, onRequestAmbulance }: Props) {
  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const state = live.caseState;
  const escalation = state?.escalation;
  const { profile } = useProfile();
  const primary = profile.contacts.find((c) => c.isPrimary);

  const reason =
    escalation?.reason === undefined
      ? 'I could not reach a conclusion I would stand behind, so I handed this to a person.'
      : REASON_TEXT[escalation.reason] ??
        escalation.detail ??
        'I handed this to a person rather than guess.';

  return (
    <View style={styles.root}>
      <BackLink label="Emergency" onPress={onBack} />

      <PopIn>
        <LinearGradient
          colors={escalateWash.colors}
          start={escalateWash.start}
          end={escalateWash.end}
          style={styles.hero}
        >
          <Label color="rgba(255,255,255,0.8)">OUTCOME 6 OF 6 · DELIBERATE</Label>
          <Text style={styles.heroTitle}>{'A human is taking\nover from here'}</Text>
          <Text style={styles.heroBody}>{reason}</Text>
        </LinearGradient>
      </PopIn>

      <Glass tone="blue" contentStyle={styles.card}>
        <Label>WHAT HAPPENS NOW</Label>
        <View style={styles.steps}>
          <Step
            done
            text={`Your case, timeline and any unresolved contradictions were sent at ${clockTime(
              escalation?.at,
            )}.`}
          />
          <Step
            n={2}
            text={
              primary === undefined
                ? 'A clinician will call you on the number in your emergency card.'
                : `A clinician calls you on ${primary.phone}.`
            }
          />
          <Step n={3} text="I keep monitoring you in the meantime. Nothing is paused." />
        </View>
      </Glass>

      <Glass tone="blue" contentStyle={styles.card}>
        <Label>IF IT GETS WORSE BEFORE THEY CALL</Label>
        <Text style={[type.body, { color: colors.inkSoft, marginTop: 9 }]}>
          Do not wait for the call. Ambulance dispatch is still available to you right now.
        </Text>
        <DangerOutlineButton
          label="Request an ambulance"
          onPress={onRequestAmbulance}
          style={{ marginTop: 13 }}
        />
      </Glass>

      <Text style={styles.footnote}>
        Escalation is one of six fixed outcomes. It is not an error and it is not a dead end.
      </Text>
    </View>
  );
}

function Step({
  n,
  done = false,
  text,
}: {
  readonly n?: number;
  readonly done?: boolean;
  readonly text: string;
}) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepBadge, done ? styles.stepDone : styles.stepPending]}>
        <Text style={[styles.stepNum, done ? { color: colors.white } : null]}>
          {done ? '✓' : String(n)}
        </Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 13 },
  hero: { borderRadius: radius.xxl, padding: 22, ...shadow('lift') },
  heroTitle: {
    fontFamily: fonts.sansBlack,
    fontSize: 27,
    lineHeight: 30,
    color: colors.white,
    marginTop: 11,
    letterSpacing: -0.6,
  },
  heroBody: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 9,
  },
  card: { padding: spacing.xl, borderRadius: radius.lg },
  steps: { marginTop: 11, gap: 11 },
  step: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  stepBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.ok },
  stepPending: {
    backgroundColor: 'rgba(29,78,216,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(29,78,216,0.3)',
  },
  stepNum: { fontFamily: fonts.monoBold, fontSize: 11, color: colors.brand },
  stepText: { flex: 1, fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 19, color: colors.ink },
  footnote: { ...type.foot, textAlign: 'center' },
});
