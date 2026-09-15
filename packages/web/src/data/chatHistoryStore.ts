/**
 * Assistant chat persistence — the fix for both "leaving the Assistant and
 * coming back loses the conversation" and "refreshing the browser resets
 * chat". A React Context alone (the fix used for the analogous mobile bug
 * earlier in this project) only survives a component unmount; it does not
 * survive a full page reload. localStorage is the one mechanism that
 * satisfies both, so both bugs share this single fix.
 *
 * No backend involved: there is no cross-device requirement here, and
 * inventing a server-side chat-history store when localStorage already
 * covers what was asked for would be exactly the "immediately invent a
 * database" the brief said not to do. `caseId` (if a session escalated to
 * a real case) still lives server-side as it always did — this only stores
 * the conversation transcript and which case it points at.
 */

const SESSIONS_KEY = 'vitalis.chatSessions.v1';
const ACTIVE_KEY = 'vitalis.chatActiveSession.v1';

/** Oldest sessions beyond this are dropped on write so localStorage can't grow unbounded. */
const MAX_SESSIONS = 20;

export interface StoredMessage {
  readonly id: string;
  readonly who: 'agent' | 'user';
  readonly text: string;
  readonly meta?: string;
}

export interface ChatSession {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly title: string;
  readonly messages: readonly StoredMessage[];
  readonly caseId?: string;
  /** Last known case summary for this session, purely for restoring the risk pill /
   * confirmation card on reload — the next real turn always overwrites it with fresh
   * server data, this is never treated as authoritative on its own. */
  readonly summary?: unknown;
}

/**
 * Stored sessions are VALIDATED, not cast.
 *
 * `loadAll` used to return `parsed as ChatSession[]` after checking only that
 * the top level was an array, which is a promise the data cannot keep: the
 * contents come from a previous build of this app, another tab, or a partial
 * write. One entry whose `messages` is missing is enough to throw inside
 * `deriveTitle`, and — because Assistant reads `session.messages.length` in a
 * `useState` initializer — to throw DURING RENDER, which unmounts the app.
 * A malformed entry is dropped instead; a corrupt history should cost the
 * user their transcript, never the screen.
 */
function isStoredMessage(value: unknown): value is StoredMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m['id'] === 'string' && (m['who'] === 'agent' || m['who'] === 'user') && typeof m['text'] === 'string';
}

function isChatSession(value: unknown): value is ChatSession {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    typeof s['createdAt'] === 'number' &&
    typeof s['updatedAt'] === 'number' &&
    typeof s['title'] === 'string' &&
    Array.isArray(s['messages']) &&
    s['messages'].every(isStoredMessage)
  );
}

function loadAll(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isChatSession) : [];
  } catch {
    return [];
  }
}

/**
 * Writes are guarded for the same reason. `setItem` throws when the origin's
 * quota is full or site data is blocked (a private window, a locked-down
 * browser), and this runs on EVERY message — so an unguarded throw here does
 * not lose a save, it breaks sending. The conversation stays correct in memory
 * either way; only its persistence is lost, which is the right thing to lose.
 */
function saveAll(sessions: readonly ChatSession[]): void {
  const trimmed = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
  } catch {
    // Retry once with a much shorter history: the common cause is quota, and
    // the oldest conversations are the cheapest thing to give up.
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed.slice(0, 3)));
    } catch {
      // Storage is genuinely unavailable. Nothing more to do here.
    }
  }
}

export function listSessions(): ChatSession[] {
  return loadAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): ChatSession | undefined {
  return loadAll().find((s) => s.id === id);
}

export function getActiveSessionId(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setActiveSessionId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // Same trade as saveAll: the session is still active in memory, it just
    // will not be the one restored after a reload.
  }
}

function deriveTitle(messages: readonly StoredMessage[]): string {
  const firstUser = messages.find((m) => m.who === 'user');
  if (firstUser === undefined) return 'New conversation';
  return firstUser.text.length > 44 ? `${firstUser.text.slice(0, 44)}…` : firstUser.text;
}

export function createSession(): ChatSession {
  const now = Date.now();
  const session: ChatSession = {
    id: `chat_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    title: 'New conversation',
    messages: [],
  };
  saveAll([...loadAll(), session]);
  setActiveSessionId(session.id);
  return session;
}

/** Upserts a session's live state. Called on every change, not just on unmount —
 * writes are cheap localStorage sets, and this is what makes "leave normally, come
 * back" and "refresh the browser" both just work off the same mechanism. */
export function saveSession(input: {
  readonly id: string;
  readonly messages: readonly StoredMessage[];
  readonly caseId?: string;
  readonly summary?: unknown;
}): void {
  const all = loadAll();
  const existing = all.find((s) => s.id === input.id);
  const next: ChatSession = {
    id: input.id,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    title: deriveTitle(input.messages),
    messages: input.messages,
    caseId: input.caseId,
    summary: input.summary,
  };
  saveAll([...all.filter((s) => s.id !== input.id), next]);
}
