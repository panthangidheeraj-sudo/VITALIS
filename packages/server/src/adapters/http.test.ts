/**
 * `requestJsonWithKeys` — the multi-credential retry this project needed
 * once it had one primary Groq key plus five spares sitting unused in
 * `.env`: a 429 on the primary used to be reported as "Groq is unavailable"
 * with four other working keys never tried.
 *
 * Every test below pins `maxAttempts: 1` on the underlying request so a
 * fetch count maps 1:1 onto "which key was this". `requestJson` itself still
 * retries a single key on a transient failure per its own policy (see
 * adapters.test.ts) — that is a separate, already-tested axis; the last test
 * here checks the two compose as expected rather than fighting each other.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJsonWithKeys } from './http.js';

const originalFetch = globalThis.fetch;
const NO_RETRY = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 5000 };

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('requestJsonWithKeys', () => {
  it('returns the first key’s result when it succeeds', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { ok: true }));
    const outcome = await requestJsonWithKeys('https://x.test', ['key-a', 'key-b'], (k) => ({
      headers: { authorization: `Bearer ${k}` },
      policy: NO_RETRY,
    }));
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('tries the next key on a 429 and returns its success', async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.['authorization'] ?? '';
      seen.push(auth);
      if (auth.includes('key-a')) return jsonResponse(429, { error: 'rate limited' });
      return jsonResponse(200, { ok: true });
    });
    const outcome = await requestJsonWithKeys('https://x.test', ['key-a', 'key-b'], (k) => ({
      headers: { authorization: `Bearer ${k}` },
      policy: NO_RETRY,
    }));
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual(['Bearer key-a', 'Bearer key-b']);
  });

  it('tries the next key on a 401/403 (a revoked or wrong credential)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const outcome = await requestJsonWithKeys('https://x.test', ['key-a', 'key-b'], (k) => ({
      headers: { authorization: `Bearer ${k}` },
      policy: NO_RETRY,
    }));
    expect(outcome.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT rotate on a 500 — a different key cannot fix a provider outage', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(500, { error: 'boom' }));
    const outcome = await requestJsonWithKeys('https://x.test', ['key-a', 'key-b'], () => ({ policy: NO_RETRY }));
    expect(outcome.ok).toBe(false);
    // Only the first key was ever tried, even though a second exists.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT rotate on a 400 — a different key cannot fix a bad request', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(400, { error: 'bad request' }));
    const outcome = await requestJsonWithKeys('https://x.test', ['key-a', 'key-b'], () => ({ policy: NO_RETRY }));
    expect(outcome.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports the LAST key’s failure when every key is exhausted', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return jsonResponse(429, { error: `exhausted-${call}` });
    });
    const outcome = await requestJsonWithKeys('https://x.test', ['key-a', 'key-b', 'key-c'], () => ({
      policy: NO_RETRY,
    }));
    expect(outcome.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('works with a single key exactly like a plain request', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { solo: true }));
    const outcome = await requestJsonWithKeys('https://x.test', ['only-key'], (k) => ({
      headers: { authorization: `Bearer ${k}` },
      policy: NO_RETRY,
    }));
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toEqual({ solo: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('composes with a per-key retry policy: each key gets its own retries before rotating', async () => {
    // maxAttempts: 2 per key, both keys rate-limited -> 2 + 2 = 4 fetches.
    globalThis.fetch = vi.fn(async () => jsonResponse(429, { error: 'rate limited' }));
    const outcome = await requestJsonWithKeys('https://x.test', ['key-a', 'key-b'], () => ({
      policy: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 5000 },
    }));
    expect(outcome.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
