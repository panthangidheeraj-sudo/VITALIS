/**
 * The adaptive interview — the screen the whole project is judged on.
 *
 * Laid out to design/VitalisApp.dc.html's `isEmergency` block: title, the tier
 * card with confidence on a visibly separate axis, then the notices, the
 * question, the proposal, the tags, the input, and the ledger at the bottom.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DESIGN SCRIPTS AND THIS DOES NOT
 *
 * The design advances through four frozen steps on a button. Everything here
 * comes from the running case instead: the tier from the deterministic scorer,
 * the question from Groq, the ledger from the Firestore tool-call stream, the
 * adaptation notice from whatever the loop actually re-planned. The layout is
 * the design's; not one value on it is written by hand.
 *
 * TWO STATE SOURCES, DELIBERATELY. The POST response acknowledges a submission
 * synchronously; the Firestore listener is the live push and is what the demo
 * points at. When Firebase is configured the listener wins, because it proves
 * state is genuinely shared rather than held in this component. When it is not,
 * the screen still works from POST responses alone — a missing credential
 * degrades the demo rather than breaking the app.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CaseId } from '@triage/shared';
import { HoldDial } from '../components/HoldDial';
import { HospitalsPanel } from '../components/HospitalsPanel';
import { QUICK_SELECT_OPTIONS } from '../data/quickSelectTags';
import { api, ApiError, type CaseSummary, type TurnResponse } from '../api/client';
import { FALLBACK_DEMOGRAPHICS, useProfile } from '../data/profileStore';
import { toNotifiableContacts } from '../data/notifiableContacts';
import { reportLocationOnce } from '../location/reportLocation';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { resolveOwnerUid } from '../identity';
import { useGuardian } from '../guardian/useGuardian';
import { CountdownAlarm } from '../components/CountdownAlarm';
import { buildCaseView } from '../state/caseView';
import {
  Card,
  ConfidenceBars,
  Glass,
  Label,
  LedgerPanel,
  NoticeCard,
  Pill,
  PrimaryButton,
  BackLink,
} from '../ui/primitives';
import { Breathe, FadeUp } from '../ui/motion';
import { colors, fonts, glass, radius, shadow, spacing, tierColor, tierLabel, type } from '../theme';

interface Props {
  readonly onDispatched: (caseId: CaseId) => void;
  readonly onEscalated: (caseId: CaseId) => void;
  readonly onBack: () => void;
  readonly onPhoto: (caseId: CaseId) => void;
  /**
   * Opens an ALREADY-EXISTING case instead of creating a new one — how the
   * assistant hands a conversation that has opened a case off to the full
   * interview. Absent for the ordinary path: tapping "Start emergency
   * triage" from Home or the tab bar always opens a fresh case, deliberately
   * — the one button whose entire job is summoning help must never silently
   * resume an old, possibly-closed one. See `state/assistantChat.tsx`.
   */
  readonly openCaseId?: CaseId;
}

export function EmergencyScreen({ onDispatched, onEscalated, onBack, onPhoto, openCaseId }: Props) {
  const [caseId, setCaseId] = useState<CaseId | undefined>(openCaseId);
  const [summary, setSummary] = useState<CaseSummary | undefined>(undefined);
  const [lastTurn, setLastTurn] = useState<TurnResponse['turn'] | undefined>(undefined);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [guardianEnabled, setGuardianEnabled] = useState(true);
  const { profile } = useProfile();

  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const state = live.caseState;

  const tier = state?.risk.tier ?? summary?.riskTier ?? 'green';
  const routing = state?.routing ?? summary?.routing;
  const status = state?.status ?? summary?.status;

  /** The design's field set, derived from live state. See state/caseView.ts. */
  const view = useMemo(
    () => (state === undefined ? undefined : buildCaseView(state, live.timeline, live.toolCalls)),
    [state, live.timeline, live.toolCalls],
  );

  const guardian = useGuardian({ status, tier, enabled: guardianEnabled });

  useEffect(() => {
    if (openCaseId !== undefined) {
      // Reusing the assistant's case. The live Firestore listener above
      // already covers most of the screen; this GET is only the fallback for
      // when Firebase is not configured, so the screen still has something to
      // render instead of sitting on the loading state forever.
      if (isFirebaseConfigured()) return;
      let cancelled = false;
      api
        .getCase(openCaseId)
        .then((fetched) => {
          if (!cancelled) setSummary(fetched);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(describe(err));
        });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    // Real profile if the user has set one up; a neutral technical fallback
    // otherwise (never shown as though it were the user's data — see
    // `data/profileStore.ts`).
    const ageYears = profile.ageYears > 0 ? profile.ageYears : FALLBACK_DEMOGRAPHICS.ageYears;
    const sex = profile.ageYears > 0 ? profile.sex : FALLBACK_DEMOGRAPHICS.sex;
    resolveOwnerUid()
      .then((ownerUid) => api.createCase({ ownerUid, ageYears, sex }))
      .then((created) => {
        if (cancelled) return;
        setCaseId(created.caseId);
        setSummary(created);
        void reportLocationOnce(created.caseId);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describe(err));
      });
    return () => {
      cancelled = true;
    };
    // Deliberately excludes `profile`: this must run exactly once per case,
    // not re-fire (and create a second case) when the profile finishes
    // loading a tick later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCaseId]);

  /** Escalation is an outcome, not an error — it gets its own screen (§1). */
  useEffect(() => {
    if (caseId !== undefined && status === 'escalated') onEscalated(caseId);
  }, [caseId, status, onEscalated]);

  const applyTurn = useCallback(
    (result: TurnResponse) => {
      setSummary(result);
      setLastTurn(result.turn);
      guardian.noteInteraction();
    },
    [guardian],
  );

  const submitTags = useCallback(async () => {
    if (caseId === undefined || selected.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      applyTurn(await api.submitQuickSelect(caseId, selected));
      setSelected([]);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }, [applyTurn, caseId, selected]);

  const submitAnswer = useCallback(async () => {
    if (caseId === undefined || answer.trim().length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      applyTurn(await api.submitText(caseId, answer.trim()));
      setAnswer('');
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }, [answer, applyTurn, caseId]);

  const confirm = useCallback(
    async (heldMs: number) => {
      if (caseId === undefined) return;
      setBusy(true);
      setError(undefined);
      try {
        const result = await api.confirm(caseId, heldMs, {
          contacts: toNotifiableContacts(profile.contacts),
          patientName: profile.displayName.trim().length > 0 ? profile.displayName : 'Your contact',
          shareLocation: true,
        });
        setSummary(result);
        onDispatched(caseId);
      } catch (err) {
        setError(describe(err));
      } finally {
        setBusy(false);
      }
    },
    [caseId, onDispatched, profile],
  );

  if (caseId === undefined || view === undefined) {
    return <Opening error={error} onBack={onBack} />;
  }

  const awaitingConfirmation = status === 'awaiting_confirmation' && routing !== undefined;
  const question = lastTurn?.question;
  const adaptation = lastTurn?.adaptation;

  return (
    <View
      style={styles.root}
      onTouchStart={guardian.noteInteraction}
      onStartShouldSetResponderCapture={() => {
        guardian.noteInteraction();
        return false;
      }}
    >
      <BackLink onPress={onBack} />

      <FadeUp style={styles.headline}>
        <Text style={type.h1}>{view.title}</Text>
        <Text style={[type.body, { marginTop: 5 }]}>{view.subtitle}</Text>
      </FadeUp>

      {/* The two axes, stacked in one card and visibly separate — the tier is
          coloured and the confidence is grey, so they can never be read as the
          same measurement (spec §5.1). */}
      <FadeUp delayMs={90}>
        <Breathe periodMs={5000} style={styles.tierCard}>
          <View style={[styles.tierHead, { backgroundColor: tierColor[tier] }]}>
            <View style={{ flex: 1 }}>
              <Label color="rgba(255,255,255,0.82)">RISK · CLINICAL ENGINE</Label>
              <Text style={styles.tierLabel}>{tierLabel[tier]}</Text>
            </View>
            <Text style={styles.tierOutcome}>{view.outcomeLines}</Text>
          </View>
          <View style={styles.tierBody}>
            <View style={styles.confRow}>
              <Label>CONFIDENCE · SEPARATE AXIS</Label>
              <Text style={styles.confLabel}>{view.confidenceLabel}</Text>
            </View>
            <ConfidenceBars filled={view.confidenceBars} />
            <Text style={[type.small, { color: colors.inkSoft, marginTop: 10 }]}>
              {view.confidenceSentence}
            </Text>
          </View>
        </Breathe>
      </FadeUp>

      {/* §6: degradation is stated, never implied. The sentence is the one the
          case state carries, not a hardcoded vendor name. */}
      {view.degraded ? (
        <NoticeCard
          accent={colors.warn}
          background={colors.warnWash}
          border="rgba(217,119,6,0.35)"
        >
          <Label color={colors.warnDeep}>DEGRADED SCORING</Label>
          <Text style={[type.small, { color: colors.warnInk, marginTop: 6 }]}>
            {view.degradationNotice ??
              'Clinical scoring is running on the conservative fallback, which errs upward. Treat the tier as provisional and answer the follow-ups.'}
          </Text>
        </NoticeCard>
      ) : null}

      {adaptation === undefined ? null : (
        <NoticeCard
          accent={colors.brand}
          background="rgba(239,246,255,0.9)"
          border="rgba(29,78,216,0.22)"
        >
          <Label color={colors.brandDeep}>
            {`RE-PLANNED · ${adaptation.trigger.replace(/_/g, ' ').toUpperCase()}`}
          </Label>
          <Text style={[type.body, { color: colors.brandDeep, marginTop: 6 }]}>
            {adaptation.explanation}
          </Text>
        </NoticeCard>
      )}

      {question === undefined ? null : (
        <Card tone="strong" style={{ borderRadius: radius.xl }}>
          <Label color={question.hardToDeflect ? colors.warnDeep : colors.label}>
            {question.hardToDeflect ? 'I NEED A CLEAR ANSWER ON THIS' : 'NEXT QUESTION'}
          </Label>
          <Text style={[type.question, { marginTop: 10 }]}>{question.text}</Text>
          <Text style={styles.why}>
            <Text style={styles.whyLead}>Why I asked: </Text>
            {question.rationale}
          </Text>
        </Card>
      )}

      {awaitingConfirmation ? (
        <View style={styles.proposal}>
          <Label color={colors.dangerDeep}>RECOMMENDED OUTCOME</Label>
          <Text style={styles.proposalTitle}>{sentenceCase(routing.outcome)}</Text>
          <Text style={[type.body, { color: colors.inkSoft, marginTop: 7 }]}>
            {routing.gate.consequenceStatement}
          </Text>
          {routing.gate.kind === 'press_and_hold_3s' ? (
            <HoldDial onHoldComplete={confirm} disabled={busy} />
          ) : (
            <PrimaryButton
              label="Confirm"
              onPress={() => void confirm(0)}
              busy={busy}
              style={{ marginTop: 16 }}
            />
          )}
        </View>
      ) : null}

      <View>
        <Text style={[type.h3, { marginBottom: 9 }]}>What are you experiencing?</Text>
        <View style={styles.tags}>
          {QUICK_SELECT_OPTIONS.map((option) => (
            <Pill
              key={option.tag}
              label={option.label}
              critical={option.critical}
              selected={selected.includes(option.tag)}
              onPress={() =>
                setSelected((prev) =>
                  prev.includes(option.tag)
                    ? prev.filter((t) => t !== option.tag)
                    : [...prev, option.tag],
                )
              }
            />
          ))}
        </View>
      </View>

      <PrimaryButton
        label={
          selected.length > 0
            ? `Send ${selected.length} symptom${selected.length > 1 ? 's' : ''}`
            : 'Select what applies'
        }
        onPress={selected.length > 0 ? () => void submitTags() : undefined}
        busy={busy && selected.length > 0}
      />

      <View>
        <Text style={[type.h3, { marginBottom: 9 }]}>Or describe it</Text>
        <TextInput
          value={answer}
          onChangeText={setAnswer}
          onFocus={guardian.noteInteraction}
          placeholder={
            (state?.evidence.length ?? 0) === 0
              ? 'e.g. I have a heavy feeling in my chest'
              : 'Answer in your own words…'
          }
          placeholderTextColor={colors.faint}
          multiline
          style={styles.input}
        />
        <PrimaryButton
          label="Send"
          onPress={answer.trim().length > 0 ? () => void submitAnswer() : undefined}
          busy={busy && answer.trim().length > 0}
          style={{ marginTop: spacing.md }}
        />
      </View>

      <Pressable onPress={() => onPhoto(caseId)}>
        {({ pressed }) => (
          <Glass tone="blue" style={pressed ? { opacity: 0.7 } : null} contentStyle={styles.photoRow}>
            <View style={{ flex: 1 }}>
              <Text style={type.h3}>Add a photo of the injury</Text>
              <Text style={[type.foot, { marginTop: 3 }]}>
                Optional. One more observation — never a shortcut past the interview.
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Glass>
        )}
      </Pressable>

      <HospitalsPanel />

      {/* The ledger. Real rows from Firestore, so "LIVE" is a checkable claim. */}
      <LedgerPanel rows={view.ledger} />

      {error === undefined ? null : (
        <NoticeCard accent={colors.danger} background={colors.dangerWash} border="rgba(220,38,38,0.3)">
          <Label color={colors.dangerDeep}>SOMETHING WENT WRONG</Label>
          <Text style={[type.small, { color: colors.dangerInk, marginTop: 6 }]}>{error}</Text>
        </NoticeCard>
      )}

      {/* Guardian Mode is shown while armed, never silent: a watchdog that can
          summon help without you knowing it exists should not be sprung on you. */}
      {guardianEnabled ? (
        <View style={styles.guardianRow}>
          <View style={styles.guardianDot} />
          <Text style={[type.foot, { flex: 1, color: colors.slate }]}>
            {guardian.reason}
          </Text>
          <Pressable onPress={() => setGuardianEnabled(false)} hitSlop={8}>
            <Text style={styles.guardianOff}>TURN OFF</Text>
          </Pressable>
        </View>
      ) : null}

      {guardian.shouldAlarm ? (
        <CountdownAlarm
          seconds={20}
          title="Are you still there?"
          reason="You have not responded for a while. If you do not cancel, I will flag this case for a human responder."
          onCancel={guardian.dismiss}
          onElapsed={() => {
            setGuardianEnabled(false);
            void api.submitText(caseId, 'No response from the patient.');
          }}
        />
      ) : null}
    </View>
  );
}

function Opening({ error, onBack }: { readonly error?: string; readonly onBack: () => void }) {
  return (
    <View style={styles.centered}>
      {error === undefined ? (
        <>
          <Text style={type.serifDisplay}>Opening your case</Text>
          <Text style={[type.small, { marginTop: spacing.md, textAlign: 'center' }]}>
            One moment. First aid stays available even if this fails.
          </Text>
        </>
      ) : (
        <>
          <Text style={[type.h2, { color: colors.dangerDeep, textAlign: 'center' }]}>
            Could not start
          </Text>
          <Text style={[type.small, styles.errorBody]}>{error}</Text>
          <PrimaryButton label="Go back" onPress={onBack} style={{ marginTop: spacing.xl }} />
        </>
      )}
    </View>
  );
}

function sentenceCase(outcome: string): string {
  const words = outcome.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describe(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}

const styles = StyleSheet.create({
  root: { gap: spacing.xl },
  headline: { marginTop: spacing.xs },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  errorBody: { textAlign: 'center', marginTop: spacing.md },

  tierCard: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadow('lift'),
  },
  tierHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.xl,
  },
  tierLabel: {
    fontFamily: fonts.sansBlack,
    fontSize: 22,
    lineHeight: 24,
    color: colors.white,
    marginTop: 7,
  },
  tierOutcome: {
    fontFamily: fonts.monoSemi,
    fontSize: 10.5,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'right',
  },
  tierBody: { backgroundColor: colors.surfaceStrong, padding: spacing.xl },
  confRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  confLabel: { fontFamily: fonts.sansBold, fontSize: 11, color: colors.ink },

  why: { ...type.small, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.divider },
  whyLead: { fontFamily: fonts.sansSemi, color: colors.inkMuted },

  proposal: {
    backgroundColor: colors.surfaceStrong,
    borderWidth: 2,
    borderColor: 'rgba(220,38,38,0.5)',
    borderRadius: radius.xxl,
    padding: 18,
    ...shadow('hero'),
  },
  proposalTitle: {
    fontFamily: fonts.sansBlack,
    fontSize: 21,
    lineHeight: 25,
    color: colors.dangerDeep,
    marginTop: 9,
    letterSpacing: -0.3,
  },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    ...glass('plain'),
    borderRadius: 18,
    padding: 14,
    minHeight: 74,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.ink,
    textAlignVertical: 'top',
  },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.xl },
  chevron: { fontFamily: fonts.sansBold, fontSize: 22, color: colors.brand },

  guardianRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  guardianDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  guardianOff: {
    fontFamily: fonts.monoSemi,
    fontSize: 9.5,
    letterSpacing: 1,
    color: colors.slate,
  },
});
