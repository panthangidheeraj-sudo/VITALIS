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
 * scorer like anything else the patient says. `needsTriage()` below only ever
 * runs BEFORE a case exists, for exactly this reason — once one exists, every
 * message goes straight to `api.submitText`, never to the general-chat
 * endpoint.
 *
 * BEFORE A CASE EXISTS, GENERAL CHAT IS REAL — not a canned refusal. Anything
 * that doesn't trip `needsTriage()` goes to `api.assistantChat`, a plain Groq
 * conversation grounded in MedlinePlus/Wikipedia when the topic matches one.
 * See `routes/assistant.ts` on the server for why that is a separate port
 * from the triage-scoped `ReasoningPort` rather than a widening of it.
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
 * THE CAMERA HERE OBEYS THE SAME RULE AS THE TEXT GATE ABOVE.
 *
 * This screen previously had no camera at all, on the grounds that a camera in
 * general chat implies photo-based diagnosis with no case behind it — the exact
 * capability the screen exists to refuse. The composer now has one, and that
 * objection is answered by ROUTING rather than by absence:
 *
 *   - The server classifies the photo first (`/assistant/image`, Gemini).
 *   - A MEDICINE pack is a lookup, not a clinical judgement, so it is answered
 *     right here, grounded in RxNorm/MedlinePlus/DailyMed.
 *   - An INJURY is never answered here. It opens (or continues) a real case and
 *     is submitted as a `photo` turn through the same `api.submitPhoto`
 *     PhotoInjuryScreen uses, so the vision model contributes an OBSERVATION
 *     and the deterministic scorer — not the image — sets the risk tier.
 *
 * So a photo of a wound still cannot produce a tier without a case behind it.
 * It just no longer requires the user to know that in advance and go find the
 * right screen.
 *
 * GROQ CANNOT SEE IMAGES. The account has no vision model, which is why
 * `GeminiVisionPort` exists server-side. Nothing on this screen sends an image
 * to `/assistant/chat`; photos go to the Gemini-backed endpoints or nowhere.
 *
 * CHAT STATE — MESSAGES AND THE OPEN CASE ID — LIVES IN A PROVIDER, NOT HERE.
 * App.tsx unmounts every screen that is not the active one, so a `useState`
 * in this component was wiped every time the user navigated away and back —
 * see `state/assistantChat.tsx`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle, Path } from 'react-native-svg';
import type { CaseId } from '@triage/shared';
import { WaveField } from '../ui/WaveField';
import { HoldDial } from '../components/HoldDial';
import { Label, PrimaryButton } from '../ui/primitives';
import { Pulse } from '../ui/motion';
import { Wordmark } from '../ui/Chrome';
import { useAssistantChat, type PendingImage } from '../state/assistantChat';
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
 * Turns a picked asset into what the server's vision path takes.
 *
 * `base64: true` is requested at pick time rather than read from the file
 * afterwards, because expo-image-picker already has the bytes and a second
 * filesystem read is both slower and one more failure mode. `quality: 0.6`
 * keeps a phone photo comfortably under the server's 10 MB JSON body limit —
 * base64 adds roughly a third on top of the encoded size.
 */
function toDataUrl(asset: ImagePicker.ImagePickerAsset): PendingImage | undefined {
  if (asset.base64 === undefined || asset.base64 === null) return undefined;
  return { uri: asset.uri, dataUrl: `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}` };
}

const PICKER_OPTIONS = { base64: true, quality: 0.6, allowsEditing: false } as const;

/** Same stroke weight and brand tint as the nav glyphs in `ui/Chrome.tsx`. */
function CameraGlyph() {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21.44 7.11L19.5 4.54a1.86 1.86 0 00-1.49-.75H5.98c-.59 0-1.12.28-1.48.75L2.55 7.11a1.88 1.88 0 00-.39 1.15v10.1c0 1.05.85 1.9 1.9 1.9h15.86c1.05 0 1.9-.85 1.9-1.9V8.26c0-.43-.14-.84-.38-1.15z"
        stroke={colors.brand}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12.5} r={3.6} stroke={colors.brand} strokeWidth={1.7} />
    </Svg>
  );
}

export function AssistantScreen({
  onOpenFullCase,
}: {
  /** Opens the same case in EmergencyScreen's full interview view — the tag
   * picker, the tool-call ledger — none of which chat has room to duplicate. */
  readonly onOpenFullCase: (caseId: CaseId) => void;
}) {
  const { messages, setMessages, draft, setDraft, pendingImage, setPendingImage, caseId, setCaseId } =
    useAssistantChat();
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

  // The keyboard opening resizes the thread (via KeyboardAvoidingView below),
  // which without this leaves the scroll position wherever it happened to be
  // — often with the latest message now hidden behind the composer/keyboard
  // boundary. `keyboardWillShow` fires before the animation on iOS so the
  // scroll lands in step with it; Android has no "will" event, only "did".
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    });
    return () => sub.remove();
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

  /**
   * Permissions are requested HERE, from the user's tap, and never on mount —
   * an app that asks for the camera the moment a chat screen opens teaches
   * people to deny it. Each path asks for only the permission it needs:
   * taking a photo does not require library access, and vice versa.
   */
  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Camera permission needed',
        "VITALIS needs camera access to take a photo. You can enable it in your phone's Settings.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (result.canceled || result.assets.length === 0) return;
    const picked = toDataUrl(result.assets[0]!);
    if (picked === undefined) {
      Alert.alert('Could not read that photo', 'Try taking it again.');
      return;
    }
    setPendingImage(picked);
  }, [setPendingImage]);

  const choosePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        "VITALIS needs access to your photos to attach one. You can enable it in your phone's Settings.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      ...PICKER_OPTIONS,
      mediaTypes: ['images'],
    });
    if (result.canceled || result.assets.length === 0) return;
    const picked = toDataUrl(result.assets[0]!);
    if (picked === undefined) {
      Alert.alert('Could not read that photo', 'Try a different one.');
      return;
    }
    setPendingImage(picked);
  }, [setPendingImage]);

  /** iOS gets its native sheet; Android gets the three-button Alert, which is
   * that platform's equivalent rather than a custom modal to maintain. */
  const attachPhoto = useCallback(() => {
    if (busy) return;
    Keyboard.dismiss();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2, title: 'Add a photo' },
        (index) => {
          if (index === 0) void takePhoto();
          if (index === 1) void choosePhoto();
        },
      );
      return;
    }
    Alert.alert('Add a photo', 'A medicine pack, or the injured area — VITALIS works out which it is.', [
      { text: 'Take photo', onPress: () => void takePhoto() },
      { text: 'Choose from library', onPress: () => void choosePhoto() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [busy, choosePhoto, takePhoto]);

  /**
   * Sends the attached photo. See the file header for why the two outcomes
   * are handled so differently: a medicine is answered here; an injury is
   * escalated onto a real case so the deterministic scorer owns the tier.
   */
  const sendImage = useCallback(
    async (image: PendingImage, caption: string) => {
      setPendingImage(undefined);
      setDraft('');
      setMessages((prev) => [
        ...prev,
        {
          id: `u${Date.now()}`,
          who: 'user' as const,
          text: caption.length > 0 ? caption : 'Sent a photo',
          imageUri: image.uri,
        },
      ]);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

      setBusy(true);
      try {
        const analysis = await api.analyzeImage(image.dataUrl);

        if (analysis.kind === 'other') {
          appendAgent(
            `That does not look like a medicine pack or an injury — ${analysis.classification.reason} Try a photo of the packaging, or of the injured area itself.`,
          );
          return;
        }

        if (analysis.kind === 'medicine') {
          const m = analysis.medicine;
          if (m.productName === undefined) {
            appendAgent(
              `Medicine identity could not be confirmed. ${m.notes}`,
              'Try again with the front of the pack in focus and good light',
            );
            return;
          }
          const lines = [
            m.strength === undefined ? m.productName : `${m.productName} ${m.strength}`,
            m.uses === undefined ? undefined : `\nCommonly used for: ${m.uses}`,
            m.expiryDateText !== undefined
              ? `\nExpiry: ${m.expiryDateText}`
              : m.expiryAmbiguous === true
                ? '\nExpiry: several dates are printed — please check the pack.'
                : '\nExpiry: not clearly visible — please verify on the package.',
            m.manufacturer === undefined ? undefined : `\nManufacturer: ${m.manufacturer}`,
          ].filter((l): l is string => l !== undefined);

          // Provenance travels with the text: MedlinePlus and the model are
          // never allowed to look like the same thing.
          const cited = (analysis.sources ?? []).map((s) => s.title).join(' · ');
          appendAgent(
            lines.join(''),
            m.usesSource === 'medlineplus' && cited.length > 0
              ? `Sources: ${cited}`
              : m.uses !== undefined
                ? 'General information from VITALIS — no matching NIH page for this name. Verify with a pharmacist.'
                : undefined,
          );
          return;
        }

        // INJURY. Never answered here — it becomes a turn on a real case.
        const id = caseId ?? (await openCase());
        if (caseId === undefined) {
          appendAgent(
            'That looks like an injury, so I am opening a case — the photo becomes part of it, and everything from here is tracked and scored properly.',
            'Case opened · photo added as an observation',
          );
        }
        const turn = await api.submitPhoto(id, image.dataUrl);
        applyTurn(turn);
      } catch (err) {
        appendAgent(
          err instanceof ApiError
            ? err.message
            : 'Could not analyse that photo. Try again, or describe what you can see instead.',
        );
      } finally {
        setBusy(false);
      }
    },
    [appendAgent, applyTurn, caseId, openCase, setDraft, setMessages, setPendingImage],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    // A photo on its own is a valid message; text is optional when one is
    // attached, which is why this guard checks both.
    if (pendingImage !== undefined) {
      if (busy) return;
      void sendImage(pendingImage, text);
      return;
    }
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

    // NO CASE YET: decide whether this message starts one. The keyword gate
    // is the ONLY thing that decides escalation — Groq is never asked and
    // has no path to override it either way.
    const escalate = needsTriage(text);
    if (!escalate) {
      setBusy(true);
      try {
        // Last few turns for context, not a transcript dump — see
        // api/client.ts's assistantChat for why this never touches case state.
        const history = messages.slice(-8).map((m) => ({
          role: m.who === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.text,
        }));
        const result = await api.assistantChat(text, history);
        appendAgent(
          result.reply,
          result.citation?.title === undefined ? undefined : `Source: ${result.citation.title}`,
        );
      } catch (err) {
        appendAgent(
          err instanceof ApiError ? err.message : 'Could not reach the assistant. Try again in a moment.',
        );
      } finally {
        setBusy(false);
      }
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
  }, [applyTurn, appendAgent, busy, caseId, draft, messages, openCase, pendingImage, sendImage, setDraft, setMessages]);

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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                <Pulse periodMs={2600} style={styles.orbDot} />
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
            {message.imageUri === undefined ? null : (
              <View style={styles.sentImageWrap}>
                <Image source={{ uri: message.imageUri }} style={styles.sentImage} />
              </View>
            )}
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

      {/* Preview sits ABOVE the composer row so attaching a photo never
          reflows the camera/input/send line the user is aiming at. */}
      {pendingImage === undefined ? null : (
        <View style={styles.previewRow}>
          <View style={styles.previewCard}>
            <Image source={{ uri: pendingImage.uri }} style={styles.previewImage} />
            <Pressable
              onPress={() => setPendingImage(undefined)}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              hitSlop={8}
              style={styles.previewRemove}
            >
              <Text style={styles.previewRemoveGlyph}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.previewHint}>Photo attached · add a note, or send it on its own</Text>
        </View>
      )}

      <View style={styles.composer}>
        <Pressable
          onPress={attachPhoto}
          accessibilityRole="button"
          accessibilityLabel="Add a photo"
          style={({ pressed }) => [styles.cameraButton, pressed ? { transform: [{ scale: 0.92 }] } : null]}
        >
          <CameraGlyph />
        </Pressable>
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

  // The shadow lives on a wrapping View, not on the Image: `shadow()` returns
  // a ViewStyle, and RN's ImageStyle is a narrower type that rejects it.
  sentImageWrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
    ...shadow('card'),
  },
  sentImage: { width: 168, height: 126 },

  previewRow: { paddingHorizontal: spacing.xxl, gap: 6 },
  previewCard: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    ...shadow('card'),
  },
  previewImage: { width: 62, height: 62, borderRadius: radius.lg },
  previewRemove: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(20,39,68,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewRemoveGlyph: { fontFamily: fonts.sansBold, fontSize: 10, color: colors.white, lineHeight: 13 },
  previewHint: { fontFamily: fonts.sans, fontSize: 10.5, color: colors.label },

  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  /** Same glass treatment as `inputWrap`, sized to match `sendButton`, so the
   * composer reads as one row of three consistent surfaces. */
  cameraButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow('card'),
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
