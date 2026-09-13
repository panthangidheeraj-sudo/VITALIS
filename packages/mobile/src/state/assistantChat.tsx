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
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface AssistantMessage {
  readonly id: string;
  readonly who: 'agent' | 'user';
  readonly text: string;
  readonly meta?: string;
  readonly handoff?: boolean;
}

interface AssistantChatState {
  readonly messages: readonly AssistantMessage[];
  readonly setMessages: (
    update: readonly AssistantMessage[] | ((prev: readonly AssistantMessage[]) => readonly AssistantMessage[]),
  ) => void;
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  readonly handoffPending: boolean;
  readonly setHandoffPending: (v: boolean) => void;
  readonly photoPrompted: boolean;
  readonly setPhotoPrompted: (v: boolean) => void;
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
  const [handoffPending, setHandoffPending] = useState(false);
  const [photoPrompted, setPhotoPrompted] = useState(false);

  const value = useMemo<AssistantChatState>(
    () => ({ messages, setMessages, draft, setDraft, handoffPending, setHandoffPending, photoPrompted, setPhotoPrompted }),
    [messages, draft, handoffPending, photoPrompted],
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
