/**
 * These pin the two ways the Assistant could be taken down by its own saved
 * history: a malformed stored session reaching the render, and a storage
 * write throwing on a path that runs for every message.
 *
 * Both matter more than they look. `loadInitialSession` runs as a `useState`
 * initializer — i.e. DURING RENDER — so a throw from either one unmounts the
 * app rather than failing a save.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SESSIONS_KEY = 'vitalis.chatSessions.v1';

/** A minimal localStorage whose writes can be made to fail on demand. */
function installStorage(options: { readonly failWrites?: boolean } = {}) {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (options.failWrites === true) throw new DOMException('quota', 'QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
  vi.stubGlobal('localStorage', store);
  return map;
}

const VALID = {
  id: 'chat_1',
  createdAt: 1,
  updatedAt: 2,
  title: 'Headache',
  messages: [{ id: 'm1', who: 'user', text: 'my head hurts' }],
};

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadModule() {
  return import('./chatHistoryStore');
}

describe('chat history: reading corrupt storage', () => {
  it('drops a session whose messages are missing instead of returning it', async () => {
    const map = installStorage();
    map.set(SESSIONS_KEY, JSON.stringify([VALID, { id: 'chat_2', createdAt: 1, updatedAt: 3, title: 'x' }]));
    const { listSessions } = await loadModule();
    expect(listSessions().map((s) => s.id)).toEqual(['chat_1']);
  });

  it('drops a session whose messages are not messages', async () => {
    const map = installStorage();
    map.set(SESSIONS_KEY, JSON.stringify([{ ...VALID, messages: ['not a message'] }]));
    const { listSessions } = await loadModule();
    expect(listSessions()).toEqual([]);
  });

  it('survives a non-array and unparseable JSON', async () => {
    const map = installStorage();
    map.set(SESSIONS_KEY, '{"not":"an array"}');
    const { listSessions } = await loadModule();
    expect(listSessions()).toEqual([]);

    map.set(SESSIONS_KEY, 'not json at all');
    vi.resetModules();
    const again = await loadModule();
    expect(again.listSessions()).toEqual([]);
  });

  it('keeps well-formed sessions untouched', async () => {
    const map = installStorage();
    map.set(SESSIONS_KEY, JSON.stringify([VALID]));
    const { getSession } = await loadModule();
    expect(getSession('chat_1')?.messages[0]?.text).toBe('my head hurts');
  });
});

describe('chat history: failing storage writes', () => {
  it('creates a session without throwing when the quota is exhausted', async () => {
    installStorage({ failWrites: true });
    const { createSession } = await loadModule();
    // The Assistant calls this during render — a throw here unmounts the app.
    expect(() => createSession()).not.toThrow();
    expect(createSession().messages).toEqual([]);
  });

  it('saves a message without throwing when the quota is exhausted', async () => {
    installStorage({ failWrites: true });
    const { saveSession } = await loadModule();
    expect(() =>
      saveSession({ id: 'chat_1', messages: [{ id: 'm1', who: 'user', text: 'hello' }] }),
    ).not.toThrow();
  });

  it('reads and writes the active id without throwing when storage is blocked', async () => {
    installStorage({ failWrites: true });
    const { getActiveSessionId, setActiveSessionId } = await loadModule();
    expect(() => setActiveSessionId('chat_1')).not.toThrow();
    expect(getActiveSessionId()).toBeUndefined();
  });

  it('falls back to a shorter history rather than losing every save', async () => {
    // Fails only on a large payload — the real shape of a quota error.
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > 400) throw new DOMException('quota', 'QuotaExceededError');
        map.set(k, v);
      },
      removeItem: (k: string) => void map.delete(k),
    });
    const { saveSession, listSessions } = await loadModule();
    for (let i = 0; i < 8; i += 1) {
      saveSession({ id: `chat_${i}`, messages: [{ id: `m${i}`, who: 'user', text: 'x'.repeat(20) }] });
    }
    // Something was persisted rather than nothing at all.
    expect(listSessions().length).toBeGreaterThan(0);
  });
});
