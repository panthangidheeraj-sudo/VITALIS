/**
 * Assistant chat state, lifted above the screen switch so it survives
 * navigation.
 *
 * App.tsx routes screens with `{screen.name === 'assistant' ? <AssistantScreen
 * /> : null}` — every screen not currently active is unmounted, not hidden.
 * That is the right choice for the emergency flow (a stray fetch or timer on
 * an off-screen Tracking view is not something this app wants running), but
 * it means any state AssistantScreen held in its own `useState` was destroyed
 * the moment the user tapped Home and rebuilt from empty the moment they
 * tapped back — the conversation looked like it had been wiped, because it
 * had been.
 *
 * The fix is not "keep the screen mounted" (that reintroduces exactly the
 * off-screen-activity problem elsewhere) but to lift the STATE one level, to a
 * provider that wraps the whole app rather than one screen. AssistantScreen
 * itself can still mount and unmount freely; the conversation lives here
 * instead and is simply still there when the screen comes back.
 *
 * ---------------------------------------------------------------------------
 * `caseId` LIVES HERE TOO, AND THAT IS DELIBERATE.
 *
 * When a message in chat looks clinical, the assistant does not open a second,
 * chat-flavoured scoring path — it starts (or continues) ONE real case through
 * the SAME `api.submitText` turn the full triage screen uses, and that case id
 * is what has to survive navigation for "continue the conversation" to mean
 * anything. Keeping it beside the messages, in the same provider, is what lets
 * AssistantScreen and EmergencyScreen agree on "the case this conversation
 * opened" without a second store to keep in sync.
 *
 * It is NOT the same thing as tapping "Start emergency triage" from Home —
 * that button always opens a fresh case on purpose, because a tap on the one
 * button whose entire job is summoning help must never silently resume an old,
 * possibly-closed case. Chat continuity and the emergency button's always-new
 * guarantee are different promises; this field only ever serves the first one.
 * ---------------------------------------------------------------------------
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CaseId } from '@triage/shared';

export interface AssistantMessage {
  readonly id: string;
  readonly who: 'agent' | 'user';
  readonly text: string;
  readonly meta?: string;
  readonly handoff?: boolean;
  /**
   * Local `file://` uri of a photo sent with this message, for the thumbnail
   * in the thread. NEVER the base64 data url — that is megabytes per image and
   * would sit in memory for the life of the conversation; it is handed to the
   * API call and dropped.
   */
  readonly imageUri?: string;
}

/** A photo chosen but not yet sent. Cleared on send, on remove, and on cancel. */
export interface PendingImage {
  /** `file://` uri, for the preview. */
  readonly uri: string;
  /** `data:image/...;base64,...`, which is what the server's vision path takes. */
  readonly dataUrl: string;
}

interface AssistantChatState {
  readonly messages: readonly AssistantMessage[];
  readonly setMessages: (
    update: readonly AssistantMessage[] | ((prev: readonly AssistantMessage[]) => readonly AssistantMessage[]),
  ) => void;
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  /** Lives here, not in the screen, for the same reason the draft text does. */
  readonly pendingImage: PendingImage | undefined;
  readonly setPendingImage: (image: PendingImage | undefined) => void;
  readonly handoffPending: boolean;
  readonly setHandoffPending: (v: boolean) => void;
  /** The case this conversation opened, once a clinical message has fired. */
  readonly caseId: CaseId | undefined;
  readonly setCaseId: (id: CaseId) => void;
}

const AssistantChatContext = createContext<AssistantChatState | undefined>(undefined);

export function AssistantChatProvider({
  opening,
  children,
}: {
  readonly opening: AssistantMessage;
  readonly children: ReactNode;
}) {
  const [messages, setMessages] = useState<readonly AssistantMessage[]>([opening]);
  const [draft, setDraft] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | undefined>(undefined);
  const [handoffPending, setHandoffPending] = useState(false);
  const [caseId, setCaseId] = useState<CaseId | undefined>(undefined);

  const value = useMemo<AssistantChatState>(
    () => ({
      messages,
      setMessages,
      draft,
      setDraft,
      pendingImage,
      setPendingImage,
      handoffPending,
      setHandoffPending,
      caseId,
      setCaseId,
    }),
    [messages, draft, pendingImage, handoffPending, caseId],
  );

  return <AssistantChatContext.Provider value={value}>{children}</AssistantChatContext.Provider>;
}

/**
 * Thrown rather than returning a silently-empty default, because a screen
 * that reads chat state with no provider above it is a wiring bug, not a
 * valid "no chat yet" state — the same distinction the rest of this codebase
 * draws between "empty" and "broken."
 */
export function useAssistantChat(): AssistantChatState {
  const ctx = useContext(AssistantChatContext);
  if (ctx === undefined) {
    throw new Error('useAssistantChat() called outside <AssistantChatProvider>.');
  }
  return ctx;
}
