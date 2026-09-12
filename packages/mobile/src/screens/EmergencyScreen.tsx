/**
 * Screen 2 - Confirmation and details (spec 9), and the adaptive interview.
 *
 * This is where the judged loop is actually visible: a symptom goes in, the
 * agent decides whether to ask something else or to score, the risk tier and
 * confidence move, and an adaptation is called out by name when the plan
 * changes mid-flow.
 *
 * Two state sources, deliberately:
 *   - the POST response is the synchronous acknowledgement of a submission
 *   - the Firestore listener is the live push (and the one the demo points at)
 * When Firebase is configured the listener wins, because it proves state is
 * genuinely shared rather than held in this component. When it is not
 * configured the screen still works from the POST responses alone, so a missing
 * service-account credential degrades the demo rather than breaking the app.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CaseId, ConfidenceLevel } from '@triage/shared';
import { PressAndHold } from '../components/PressAndHold';
import { RiskBadge } from '../components/RiskBadge';
import { QUICK_SELECT_OPTIONS } from '../data/quickSelectTags';
import { api, ApiError, type CaseSummary, type TurnResponse } from '../api/client';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { colors, radius, spacing, type } from '../theme';

interface Props {
  readonly onDispatched: (caseId: CaseId) => void;
  readonly onBack: () => void;
}

export function EmergencyScreen({ onDispatched, onBack }: Props) {
  const [caseId, setCaseId] = useState<CaseId | undefined>(undefined);
  const [summary, setSummary] = useState<CaseSummary | undefined>(undefined);
  const [lastTurn, setLastTurn] = useState<TurnResponse['turn'] | undefined>(undefined);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);

  // Prefer live Firestore state when it is flowing; fall back to the POST
  // acknowledgement otherwise.
  const tier = live.caseState?.risk.tier ?? summary?.riskTier ?? 'green';
  const confidence = live.caseState?.confidence;
  const confidenceLevel: ConfidenceLevel =
    confidence?.level ?? (summary?.confidence.level as ConfidenceLevel | undefined) ?? 'medium';
  const confidenceScore = confidence?.score ?? summary?.confidence.score ?? 0.6;
  const alertActive = confidence?.alertActive ?? summary?.confidenceAlertActive ?? false;
  const routing = live.caseState?.routing ?? summary?.routing;
  const escalation = live.caseState?.escalation ?? summary?.escalation;
  const degradedNotice = live.caseState?.degradation.notice ?? summary?.degradationNotice;

  useEffect(() => {
    let cancelled = false;
    api
      .createCase({ ageYears: 52, sex: 'male' })
      .then((created) => {
        if (cancelled) return;
        setCaseId(created.caseId);
        setSummary(created);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describe(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyTurn = useCallback((result: TurnResponse) => {
    setSummary(result);
    setLastTurn(result.turn);
  }, []);

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
        const result = await api.confirm(caseId, heldMs);
        setSummary(result);
        onDispatched(caseId);
      } catch (err) {
        setError(describe(err));
      } finally {
        setBusy(false);
      }
    },
    [caseId, onDispatched],
  );

  if (caseId === undefined) {
    return (
      <View style={styles.centered}>
        {error === undefined ? (
          <>
            <ActivityIndicator size="large" color={colors.danger} />
            <Text style={[type.small, { marginTop: spacing.md }]}>Opening case...</Text>
          </>
        ) : (
          <>
            <Text style={styles.errorTitle}>Could not start</Text>
            <Text style={[type.small, styles.errorBody]}>{error}</Text>
            <Pressable onPress={onBack} style={styles.linkButton}>
              <Text style={styles.linkText}>Go back</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const awaitingConfirmation = routing !== undefined && routing.gate.state !== 'satisfied';
  const needsHold = routing?.gate.kind === 'press_and_hold_3s';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={type.h1}>Are you in an emergency?</Text>
      <Text style={type.small}>Tell me what is happening. I will ask one thing at a time.</Text>

      <RiskBadge
        tier={tier}
        confidenceLevel={confidenceLevel}
        confidenceScore={confidenceScore}
        alertActive={alertActive}
        degradedNotice={degradedNotice}
      />

      {live.connected ? (
        <Text style={styles.liveTag}>LIVE - updating from shared case state</Text>
      ) : null}

      {/* The agent's current question. */}
      {lastTurn?.question !== undefined ? (
        <View style={[styles.card, lastTurn.question.hardToDeflect && styles.cardUrgent]}>
          <Text style={styles.cardLabel}>
            {lastTurn.question.hardToDeflect ? 'I NEED A CLEAR ANSWER ON THIS' : 'NEXT QUESTION'}
          </Text>
          <Text style={styles.question}>{lastTurn.question.text}</Text>
          <Text style={styles.rationale}>Why: {lastTurn.question.rationale}</Text>
        </View>
      ) : null}

      {/* Adaptation: the moment the plan changed. */}
      {lastTurn?.adaptation !== undefined ? (
        <View style={styles.adaptation}>
          <Text style={styles.adaptationLabel}>
            RE-PLANNED / {lastTurn.adaptation.trigger.replace(/_/g, ' ')}
          </Text>
          <Text style={styles.adaptationBody}>{lastTurn.adaptation.explanation}</Text>
        </View>
      ) : null}

      {escalation?.escalated === true ? (
        <View style={styles.escalated}>
          <Text style={styles.escalatedTitle}>Escalated to a human responder</Text>
          <Text style={styles.escalatedBody}>{escalation.detail}</Text>
        </View>
      ) : null}

      {/* Routing proposal, behind its gate. */}
      {awaitingConfirmation && routing !== undefined ? (
        <View style={styles.proposal}>
          <Text style={styles.cardLabel}>RECOMMENDED</Text>
          <Text style={styles.proposalOutcome}>{routing.outcome.replace(/_/g, ' ')}</Text>
          <Text style={styles.proposalConsequence}>{routing.gate.consequenceStatement}</Text>

          {needsHold ? (
            <PressAndHold
              label="Hold to confirm"
              onHoldComplete={(heldMs) => void confirm(heldMs)}
              disabled={busy}
              style={{ marginTop: spacing.md }}
            />
          ) : (
            <Pressable style={styles.confirmButton} onPress={() => void confirm(0)} disabled={busy}>
              <Text style={styles.confirmText}>Confirm</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Quick-select tags. */}
      <Text style={styles.sectionTitle}>What are you experiencing?</Text>
      <View style={styles.tags}>
        {QUICK_SELECT_OPTIONS.map((opt) => {
          const on = selected.includes(opt.tag);
          return (
            <Pressable
              key={opt.tag}
              onPress={() =>
                setSelected((prev) =>
                  prev.includes(opt.tag) ? prev.filter((t) => t !== opt.tag) : [...prev, opt.tag],
                )
              }
              style={[styles.tag, on && styles.tagOn, opt.critical && !on && styles.tagCritical]}
            >
              <Text style={[styles.tagText, on && styles.tagTextOn]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {selected.length > 0 ? (
        <Pressable style={styles.primaryButton} onPress={() => void submitTags()} disabled={busy}>
          <Text style={styles.primaryText}>
            Send {selected.length} symptom{selected.length > 1 ? 's' : ''}
          </Text>
        </Pressable>
      ) : null}

      {/* Free text. */}
      <Text style={styles.sectionTitle}>Or describe it</Text>
      <TextInput
        style={styles.input}
        value={answer}
        onChangeText={setAnswer}
        placeholder="e.g. I have a heavy feeling in my chest"
        placeholderTextColor={colors.textFaint}
        multiline
        editable={!busy}
      />
      <Pressable
        style={[styles.primaryButton, (busy || answer.trim().length === 0) && styles.buttonDisabled]}
        onPress={() => void submitAnswer()}
        disabled={busy || answer.trim().length === 0}
      >
        <Text style={styles.primaryText}>{busy ? 'Working...' : 'Send'}</Text>
      </Pressable>

      {error !== undefined ? <Text style={styles.inlineError}>{error}</Text> : null}

      {lastTurn !== undefined ? (
        <Text style={styles.ledger}>
          turn {lastTurn.index} / {lastTurn.decidedAction} / {lastTurn.extractedEvidence} new
          evidence / {lastTurn.toolCallCount} tool calls
        </Text>
      ) : null}

      <Pressable onPress={onBack} style={styles.linkButton}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

function describe(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  liveTag: { ...type.tiny, color: colors.success, fontWeight: '700' },
  sectionTitle: { ...type.h3, marginTop: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardUrgent: { borderColor: colors.warning, borderWidth: 2 },
  cardLabel: { ...type.tiny, letterSpacing: 0.6, marginBottom: spacing.xs },
  question: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  rationale: { ...type.small, fontStyle: 'italic' },

  adaptation: {
    backgroundColor: '#EFF6FF',
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  adaptationLabel: {
    ...type.tiny,
    color: colors.primaryDark,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  adaptationBody: { fontSize: 14, color: colors.primaryDark, marginTop: 2, lineHeight: 19 },

  escalated: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  escalatedTitle: { ...type.h3, color: colors.dangerDark },
  escalatedBody: { fontSize: 14, color: colors.dangerDark, marginTop: 2, lineHeight: 19 },

  proposal: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.danger,
    padding: spacing.lg,
  },
  proposalOutcome: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.dangerDark,
    textTransform: 'capitalize',
    marginBottom: spacing.xs,
  },
  proposalConsequence: { ...type.body, lineHeight: 20 },
  confirmButton: {
    marginTop: spacing.md,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  confirmText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tagCritical: { borderColor: '#FCA5A5' },
  tagOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  tagText: { fontSize: 14, color: colors.text },
  tagTextOn: { color: '#FFFFFF', fontWeight: '700' },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: 15,
    color: colors.text,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: colors.textFaint },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  errorTitle: { ...type.h2, color: colors.danger, marginBottom: spacing.sm },
  errorBody: { textAlign: 'center' },
  inlineError: { ...type.small, color: colors.danger },
  ledger: { ...type.mono },

  linkButton: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});
