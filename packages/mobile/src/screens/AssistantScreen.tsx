/**
 * The AI assistant — the design's `isAssistant` screen.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS SCREEN EXISTS TO ENFORCE
 *
 * General health questions are answered here. Anything that looks like an
 * emergency is NOT — it becomes a real turn on a real case, through the exact
 * same `api.submitText` the full triage screen calls. There is no second
 * scoring path: the deterministic scorer, the confidence axis, the
 * contradiction check and the press-and-hold gate are the same code running
 * whether the words came from this composer or from EmergencyScreen's. What
 * changes is only where the conversation happens to be typed.
 *
 * So the gate that decides "does this become a case?" is a LOCAL keyword
 * check, not a model judgement. A model deciding whether a message is an
 * emergency is a model with a veto over the emergency path, and the §6
 * boundary says no model gets that. It over-triggers on purpose: being routed
 * into triage when you did not need it costs a tap; the opposite costs much
 * more.
 * ---------------------------------------------------------------------------
 *
 * ONCE A CASE IS OPEN, EVERY MESSAGE IN THIS CHAT IS A TURN ON IT — not just
 * the one that triggered it. "Hi" after "I have chest pain" is not small talk
 * anymore; it is the next thing the interview heard, and it has to reach the
 * scorer like anything else the patient says. The small-talk detector below
 * only ever runs BEFORE a case exists, for exactly this reason.
 *
 * THE TIER SHOWN HERE IS THE SAME TIER, not a chat-only estimate. It comes
 * from `buildCaseView` over the same live `CaseState` EmergencyScreen reads —
 * see `state/caseView.ts`. There is nothing on this screen that could disagree
 * with the full triage view, because they are reading the same document.
 *
 * THE HOLD DIAL IS THE SAME COMPONENT, not a second confirmation mechanism.
 * When a routing decision is proposed mid-conversation, `<HoldDial>` — the
 * exact component EmergencyScreen uses — renders inline here too, calling the
 * same `api.confirm`.
 *
 * NO CAMERA HERE, DELIBERATELY. Injury photography (§5.7) attaches to a case
 * that already exists and is reached from the full triage view
 * (`PhotoInjuryScreen`) — a camera icon in general chat implied photo-based
 * diagnosis with no case behind it, which is exactly the capability this
 * screen exists to refuse.
 *
 * CHAT STATE — MESSAGES AND THE OPEN CASE ID — LIVES IN A PROVIDER, NOT HERE.
 * App.tsx unmounts every screen that is not the active one, so a `useState`
 * in this component was wiped every time the user navigated away and back —
 * see `state/assistantChat.tsx`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CaseId } from '@triage/shared';
import { WaveField } from '../ui/WaveField';
import { HoldDial } from '../components/HoldDial';
import { Label, PrimaryButton } from '../ui/primitives';
import { Wordmark } from '../ui/Chrome';
import { useAssistantChat } from '../state/assistantChat';
import { api, ApiError, type TurnResponse } from '../api/client';
import { FALLBACK_DEMOGRAPHICS, useProfile } from '../data/profileStore';
import { toNotifiableContacts } from '../data/notifiableContacts';
import { reportLocationOnce } from '../location/reportLocation';
import { resolveOwnerUid } from '../identity';
import { useCaseState } from '../firebase/useCaseState';
import { isFirebaseConfigured } from '../firebase/client';
import { buildCaseView } from '../state/caseView';
import { colors, fonts, radius, shadow, spacing, tierColor, tierLabel, type } from '../theme';

/**
 * Words that start a case.
 *
 * Deliberately blunt and deliberately broad. This list will produce false
 * positives — "my head hurts a bit" opens a case — and that is the correct
 * direction to be wrong in. Reviewing it is a clinical task, which is why it is
 * a plain readable list rather than a regex nobody can check.
 */
const ESCALATE_TERMS = [
  'chest', 'heart attack', 'breath', 'breathing', 'choking', 'bleeding', 'blood',
  'unconscious', 'faint', 'fainted', 'collapse', 'collapsed', 'seizure', 'fit',
  'stroke', 'paralys', 'numb', 'slurred', 'overdose', 'poison', 'burn', 'burnt',
  'broken', 'fracture', 'head injury', 'suicid', 'kill myself', 'emergency',
  'ambulance', 'severe', 'worst pain', 'cannot move', "can't move", 'vomiting blood',
];

function needsTriage(text: string): boolean {
  const lower = text.toLowerCase();
  return ESCALATE_TERMS.some((term) => lower.includes(term));
}

/**
 * Small talk gets a small-talk answer, not the "I cannot answer general
 * health questions yet" deflection. Only ever consulted before a case exists
 * — see the file header for why "hi" mid-interview is not small talk.
 */
const GREETING_PATTERN = /^\s*(hi|hello|hey|yo|hii+|hiya|good\s?(morning|afternoon|evening)|thanks?|thank\s?you|ty|bye|goodbye|ok|okay)\s*[!.]*\s*$/i;

function greetingReply(text: string): string | undefined {
  if (!GREETING_PATTERN.test(text)) return undefined;
  const lower = text.toLowerCase();
  if (/thank/.test(lower) || lower === 'ty') {
    return "You're welcome. I'm here if anything comes up — and if it's urgent, say so and I'll start tracking it as a case.";
  }
  if (/bye|goodbye/.test(lower)) {
    return 'Take care. Your emergency card and first aid guides stay available offline any time.';
  }
  return 'Hi — ask me about a reading, a medication, or how you are feeling. If it sounds urgent I will start a case and track it properly.';
}

export function AssistantScreen({
  onOpenFullCase,
}: {
  /** Opens the same case in EmergencyScreen's full interview view — the tag
   * picker, the tool-call ledger — none of which chat has room to duplicate. */
  readonly onOpenFullCase: (caseId: CaseId) => void;
}) {
  const { messages, setMessages, draft, setDraft, caseId, setCaseId } = useAssistantChat();
  const scroller = useRef<ScrollView>(null);
  const [busy, setBusy] = useState(false);
  const { profile } = useProfile();

  const live = useCaseState(isFirebaseConfigured() ? caseId : undefined);
  const state = live.caseState;
  const view = useMemo(
    () => (state === undefined ? undefined : buildCaseView(state, live.timeline, live.toolCalls)),
    [state, live.timeline, live.toolCalls],
  );
  const awaitingConfirmation = state?.status === 'awaiting_confirmation' && state.routing !== undefined;

  useEffect(() => {
    if (messages.length > 1) {
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appendAgent = useCallback(
    (text: string, meta?: string, handoff?: boolean) => {
      setMessages((prev) => [
        ...prev,
        { id: `a${Date.now()}${Math.random()}`, who: 'agent' as const, text, ...(meta === undefined ? {} : { meta }), ...(handoff === undefined ? {} : { handoff }) },
      ]);
    },
    [setMessages],
  );

  /** Opens the case this conversation needs, once, the first time it needs one. */
  const openCase = useCallback(async (): Promise<CaseId> => {
    const ownerUid = await resolveOwnerUid();
    // Real profile if set up; otherwise a neutral technical fallback — see
    // `data/profileStore.ts`.
    const ageYears = profile.ageYears > 0 ? profile.ageYears : FALLBACK_DEMOGRAPHICS.ageYears;
    const sex = profile.ageYears > 0 ? profile.sex : FALLBACK_DEMOGRAPHICS.sex;
    const created = await api.createCase({ ownerUid, ageYears, sex });
    setCaseId(created.caseId);
    void reportLocationOnce(created.caseId);
    return created.caseId;
  }, [profile, setCaseId]);

  const applyTurn = useCallback(
    (result: TurnResponse) => {
      if (result.turn.question !== undefined) {
        appendAgent(
          result.turn.question.text,
          result.turn.question.hardToDeflect ? 'I need a clear answer on this' : undefined,
        );
      }
      if (result.turn.adaptation !== undefined) {
        appendAgent(
          result.turn.adaptation.explanation,
          `Re-planned · ${result.turn.adaptation.trigger.replace(/_/g, ' ')}`,
        );
      }
      if (result.turn.question === undefined && result.turn.adaptation === undefined) {
        appendAgent('Noted. Keep going, or tell me if anything changes.');
      }
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    },
    [appendAgent],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    setDraft('');
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, who: 'user' as const, text }]);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

    // A CASE ALREADY EXISTS: every message is now a turn on it, full stop —
    // no re-running the small-talk/escalation check. See the file header.
    if (caseId !== undefined) {
      setBusy(true);
      try {
        applyTurn(await api.submitText(caseId, text));
      } catch (err) {
        appendAgent(
          err instanceof ApiError
            ? err.message
            : 'That did not reach your case. Try again, or open the full interview.',
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    // NO CASE YET: decide whether this message starts one.
    const escalate = needsTriage(text);
    if (!escalate) {
      const greeting = greetingReply(text);
      appendAgent(
        greeting ??
          'I cannot answer general health questions yet — the assistant is not wired to a knowledge endpoint in this build, and I would rather say so than make something up. If this is about symptoms you are having right now, tell me and I will start tracking it as a case.',
        greeting === undefined ? 'General chat: not available · triage: available' : undefined,
      );
      return;
    }

    setBusy(true);
    appendAgent(
      'That needs proper tracking, not a chat answer — I am opening a case and everything from here becomes part of it. You can cancel at any point.',
      'Case opened · scored by the same engine as full triage',
    );
    try {
      const id = await openCase();
      applyTurn(await api.submitText(id, text));
    } catch (err) {
      appendAgent(
        err instanceof ApiError ? err.message : 'Could not open a case. Try the full triage screen instead.',
      );
    } finally {
      setBusy(false);
    }
  }, [applyTurn, appendAgent, busy, caseId, draft, openCase, setDraft, setMessages]);

  const confirm = useCallback(
    async (heldMs: number) => {
      if (caseId === undefined) return;
      setBusy(true);
      try {
        await api.confirm(caseId, heldMs, {
          contacts: toNotifiableContacts(profile.contacts),
          patientName: profile.displayName.trim().length > 0 ? profile.displayName : 'Your contact',
          shareLocation: true,
        });
        onOpenFullCase(caseId);
      } catch (err) {
        appendAgent(err instanceof ApiError ? err.message : 'Could not confirm. Try the full triage screen.');
      } finally {
        setBusy(false);
      }
    },
    [appendAgent, caseId, onOpenFullCase, profile],
  );

  const started = messages.length > 1;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <WaveField />

      <View style={styles.header}>
        <Wordmark />
        {/* The live tier — same document, same engine, read here or on the
            full screen. Present only once a case exists. */}
        {view !== undefined ? (
          <Pressable
            onPress={() => onOpenFullCase(caseId as CaseId)}
            style={[styles.tierChip, { backgroundColor: tierColor[view.tier] }]}
          >
            <Text style={styles.tierChipText}>{tierLabel[view.tier]}</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scroller}
        style={styles.thread}
        contentContainerStyle={styles.threadPad}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {started ? null : (
          <View style={styles.hero}>
            <View style={styles.orbOuter}>
              <View style={styles.orbRing} />
              <View style={styles.orbCore}>
                <View style={styles.orbDot} />
              </View>
            </View>
            <Label style={{ marginTop: 10, letterSpacing: 1.7 }}>VITALIS AI ASSISTANT</Label>
            <Text style={styles.greeting}>{'How can I\nhelp you today?'}</Text>
          </View>
        )}

        {messages.map((message) => (
          <View
            key={message.id}
            style={[styles.row, message.who === 'user' ? styles.rowUser : styles.rowAgent]}
          >
            <View style={message.who === 'user' ? styles.userBubble : styles.agentBubble}>
              <Text style={message.who === 'user' ? styles.userText : styles.agentText}>
                {message.text}
              </Text>
            </View>
            {message.meta === undefined ? null : (
              <Text style={styles.meta}>{message.meta}</Text>
            )}
          </View>
        ))}

        {/* The hold dial — the SAME component EmergencyScreen uses, calling
            the same api.confirm. Not a second confirmation mechanism. */}
        {awaitingConfirmation && state?.routing !== undefined ? (
          <View style={styles.proposal}>
            <Label color={colors.dangerDeep}>RECOMMENDED OUTCOME</Label>
            <Text style={styles.proposalTitle}>
              {state.routing.outcome.replace(/_/g, ' ')}
            </Text>
            <Text style={[type.small, { marginTop: 6 }]}>{state.routing.gate.consequenceStatement}</Text>
            {state.routing.gate.kind === 'press_and_hold_3s' ? (
              <HoldDial onHoldComplete={confirm} disabled={busy} />
            ) : (
              <PrimaryButton label="Confirm" onPress={() => void confirm(0)} busy={busy} style={{ marginTop: 16 }} />
            )}
          </View>
        ) : null}

        {caseId !== undefined ? (
          <Pressable onPress={() => onOpenFullCase(caseId)} style={{ alignSelf: 'center', marginTop: spacing.md }}>
            <Text style={styles.fullCaseLink}>Open full interview →</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <View style={styles.inputWrap}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask Vitalis anything about your health…"
            placeholderTextColor={colors.faint}
            style={styles.input}
            onSubmitEditing={() => void send()}
            returnKeyType="send"
          />
        </View>
        <Pressable
          onPress={() => void send()}
          style={({ pressed }) => [styles.sendButton, pressed ? { transform: [{ scale: 0.9 }] } : null]}
        >
          <Text style={styles.sendGlyph}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tierChip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: radius.pill },
  tierChipText: { fontFamily: fonts.sansBold, fontSize: 10.5, color: colors.white, letterSpacing: 0.4 },
  thread: { flex: 1 },
  threadPad: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xl, gap: spacing.lg },

  hero: { alignItems: 'center', paddingVertical: spacing.xxl },
  orbOuter: {
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbRing: {
    position: 'absolute',
    width: 94,
    height: 94,
    borderRadius: 47,
    borderWidth: 1,
    borderColor: 'rgba(29,78,216,0.12)',
  },
  orbCore: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow('lift'),
  },
  orbDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  greeting: {
    fontFamily: fonts.serif,
    fontSize: 24,
    lineHeight: 29,
    color: colors.ink,
    textAlign: 'center',
    marginTop: 9,
    letterSpacing: 0.2,
  },

  row: { gap: 5 },
  rowUser: { alignItems: 'flex-end' },
  rowAgent: { alignItems: 'flex-start' },
  userBubble: {
    maxWidth: '80%',
    backgroundColor: colors.brand,
    borderRadius: 18,
    borderBottomRightRadius: 5,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...shadow('card'),
  },
  userText: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 20, color: colors.white },
  agentBubble: {
    maxWidth: '88%',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    paddingVertical: 13,
    paddingHorizontal: 15,
    ...shadow('card'),
  },
  agentText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: colors.ink },
  meta: { fontFamily: fonts.monoMedium, fontSize: 10, lineHeight: 14, color: colors.label, paddingHorizontal: 4 },

  proposal: {
    marginTop: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 2,
    borderColor: 'rgba(220,38,38,0.5)',
    borderRadius: radius.xxl,
    padding: 18,
    ...shadow('hero'),
  },
  proposalTitle: {
    fontFamily: fonts.sansBlack,
    fontSize: 18,
    color: colors.dangerDeep,
    marginTop: 8,
    textTransform: 'capitalize',
  },
  fullCaseLink: { fontFamily: fonts.sansSemi, fontSize: 12, color: colors.brand },

  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    borderRadius: radius.pill,
    paddingHorizontal: 17,
    ...shadow('card'),
  },
  input: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.ink,
    paddingVertical: 13,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.brand,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow('lift'),
  },
  sendGlyph: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.white },
});
