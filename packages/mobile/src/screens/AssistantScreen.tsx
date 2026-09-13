/**
 * The AI assistant — the design's `isAssistant` screen.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS SCREEN EXISTS TO ENFORCE
 *
 * General health questions are answered here. Anything that looks like an
 * emergency is NOT. The design's own script shows exactly this: the assistant
 * answers a blood-pressure question happily, and the moment the user says
 * "my chest feels a bit heavy" it stops and says so —
 *
 *     "I am going to stop the general conversation there. Chest heaviness with
 *      your history needs the triage interview, not a chat answer."
 *
 * That is a hard handoff, not a suggestion, and it is the difference between a
 * medical chatbot and this system. A free-text model reply about chest pain
 * would bypass the deterministic scorer, the confidence axis, the
 * contradiction check and the press-and-hold gate all at once — every safety
 * property the rest of the app is built from, defeated by a text box.
 *
 * So the gate is a LOCAL keyword check, not a model judgement. A model deciding
 * whether a message is an emergency is a model with a veto over the emergency
 * path, and the §6 boundary says no model gets that. It over-triggers on
 * purpose: being sent to the interview when you did not need it costs a tap,
 * and the opposite costs much more.
 * ---------------------------------------------------------------------------
 *
 * NO CAMERA HERE, DELIBERATELY. A photo-attach affordance briefly lived in
 * this composer and was removed: injury photography (§5.7, "AI Injury Scan")
 * is scoped to an ACTIVE emergency case — the vision port describes what is
 * visible and that becomes one more piece of evidence on a case record that
 * does not exist yet on this screen. A camera icon here implied general
 * photo-based diagnosis, which is exactly the capability this screen exists
 * to refuse. The photo step lives inside the triage flow, on
 * `PhotoInjuryScreen`, reached from `EmergencyScreen`.
 *
 * CHAT STATE LIVES IN A PROVIDER, NOT HERE. App.tsx unmounts every screen that
 * is not the active one, so a `useState` in this component was wiped every
 * time the user navigated away and back — see `state/assistantChat.tsx`.
 *
 * There is no general-chat endpoint on the orchestrator yet, so the assistant
 * cannot answer freely. Rather than fake replies, an unrecognised message gets
 * an honest "I cannot answer general questions yet" and the triage route stays
 * one tap away. A fabricated health answer is the worst thing this file could
 * contain. (Confirmed working-as-designed, not a bug — see the assistant
 * chat's own status line: "General chat: not available · triage: available."
 * Wiring it up is a separate, larger decision — see the PR discussion on
 * scope before that gets built.)
 */

import { useCallback, useEffect, useRef } from 'react';
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
import { WaveField } from '../ui/WaveField';
import { Label, PrimaryButton } from '../ui/primitives';
import { Wordmark } from '../ui/Chrome';
import { useAssistantChat } from '../state/assistantChat';
import { colors, fonts, radius, shadow, spacing, type } from '../theme';

/**
 * Words that end the conversation and start the interview.
 *
 * Deliberately blunt and deliberately broad. This list will produce false
 * positives — "my head hurts a bit" routes to triage — and that is the correct
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
 * health questions yet" deflection.
 *
 * That deflection exists so the assistant never fabricates a medical answer —
 * it has no reason to fire on "hi". A plain greeting matched against zero
 * clinical content the deflection was built to guard, so answering it plainly
 * carries none of the fabrication risk the rest of this file is written
 * around.
 */
const GREETING_PATTERN = /^\s*(hi|hello|hey|yo|hii+|hiya|good\s?(morning|afternoon|evening)|thanks?|thank\s?you|ty|bye|goodbye|ok|okay)\s*[!.]*\s*$/i;

function greetingReply(text: string): string | undefined {
  if (!GREETING_PATTERN.test(text)) return undefined;
  const lower = text.toLowerCase();
  if (/thank/.test(lower) || lower === 'ty') {
    return "You're welcome. I'm here if anything comes up — and if it's urgent, say so and I'll move you straight to triage.";
  }
  if (/bye|goodbye/.test(lower)) {
    return 'Take care. Your emergency card and first aid guides stay available offline any time.';
  }
  return 'Hi — ask me about a reading, a medication, or how you are feeling. If it sounds urgent I will move you to the triage interview instead.';
}

export function AssistantScreen({ onStartTriage }: { readonly onStartTriage: () => void }) {
  const { messages, setMessages, draft, setDraft, handoffPending, setHandoffPending } =
    useAssistantChat();
  const scroller = useRef<ScrollView>(null);

  // Land back where the conversation left off, not at the top, when this
  // screen remounts after navigating away and back.
  useEffect(() => {
    if (messages.length > 1) {
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: false }));
    }
    // Intentionally once on mount — this is a "restore scroll position," not
    // a "follow new messages" effect; `send` already scrolls on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft('');

    const user = { id: `u${Date.now()}`, who: 'user' as const, text };
    const escalate = needsTriage(text);
    const greeting = escalate ? undefined : greetingReply(text);

    const reply = escalate
      ? {
          id: `a${Date.now()}`,
          who: 'agent' as const,
          handoff: true,
          text: 'I am going to stop the general conversation there. What you have described needs the triage interview, not a chat answer. It takes about a minute and I ask one thing at a time.',
          meta: 'You can cancel at any point · nothing is dispatched without you',
        }
      : greeting !== undefined
        ? { id: `a${Date.now()}`, who: 'agent' as const, text: greeting }
        : {
            id: `a${Date.now()}`,
            who: 'agent' as const,
            text: 'I cannot answer general health questions yet — the assistant is not wired to a knowledge endpoint in this build, and I would rather say so than make something up. If this is about symptoms you are having right now, start the triage interview and I can actually help.',
            meta: 'General chat: not available · triage: available',
          };

    setMessages((prev) => [...prev, user, reply]);
    setHandoffPending(escalate);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  }, [draft, setDraft, setHandoffPending, setMessages]);

  const started = messages.length > 1;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <WaveField />

      <View style={styles.header}>
        <Wordmark />
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

        {/* The handoff is a button, not a link inside a sentence. Once the
            assistant has said it is stopping, continuing to type must be the
            harder path. */}
        {handoffPending ? (
          <PrimaryButton
            label="Start emergency triage"
            onPress={onStartTriage}
            style={{ marginTop: spacing.lg }}
          />
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
            onSubmitEditing={send}
            returnKeyType="send"
          />
        </View>
        <Pressable
          onPress={send}
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
  header: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xs, paddingBottom: spacing.sm },
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
