/**
 * The last-resort error handler is the one place every unexpected throw in
 * the server converges, which makes it the one place a credential can leak
 * without any adapter being involved.
 *
 * `adapters/http.ts` strips the query string from URLs it reports, because
 * Gemini authenticates with `?key=<GEMINI_API_KEY>` and that message used to
 * reach the browser. But an error thrown OUTSIDE an adapter — by
 * firebase-admin, by the Node runtime, by a third-party client — never passes
 * through that sanitiser and lands here instead. These tests pin that this
 * end of the hole stays shut.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevisionConflictError, asCaseId } from '@triage/shared';
import { CaseNotFoundError } from '@triage/agent';
import { errorHandler } from './cases.js';

interface Captured {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Enough of an Express `Response` for this handler: `.status().json()`. */
function runHandler(err: unknown): Captured {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      body = payload;
      return this;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorHandler(err, {} as any, res as any, undefined);
  return { status, body };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorHandler', () => {
  it('does not put an unexpected error’s own message in the response', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const leaky = new Error('POST https://generativelanguage.googleapis.com/v1/models:generateContent?key=AIzaSyLEAKED failed');

    const { status, body } = runHandler(leaky);

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('AIzaSyLEAKED');
    expect(JSON.stringify(body)).not.toContain('key=');
    expect(JSON.stringify(body)).not.toContain('googleapis.com');
    expect(body['error']).toBe('internal_error');
    // Still logged server-side — hiding it from the client must not mean
    // losing it for whoever has to debug the incident.
    expect(spy).toHaveBeenCalledWith('[server] unhandled error:', leaky);
  });

  it('does not leak a stack trace', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { body } = runHandler(new Error('boom'));
    expect(JSON.stringify(body)).not.toMatch(/\bat \S+:\d+/);
    expect(body).not.toHaveProperty('stack');
  });

  it('still says something the user can act on', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { body } = runHandler(new Error('ECONNREFUSED 10.0.0.4:5432'));
    expect(String(body['message'])).toMatch(/try again/i);
    expect(String(body['message'])).not.toContain('10.0.0.4');
  });

  it('handles a thrown non-Error without leaking it either', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { status, body } = runHandler({ apiKey: 'AIzaSyLEAKED' });
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('AIzaSyLEAKED');
  });

  it('keeps returning the messages this codebase wrote for known failures', () => {
    // These three are ours, not a third party's, and the client needs them:
    // suppressing them too would make every failure indistinguishable.
    expect(runHandler(new CaseNotFoundError(asCaseId('case_123')))).toMatchObject({
      status: 404,
      body: { error: 'case_not_found' },
    });
    expect(runHandler(new RevisionConflictError(asCaseId('case_123'), 2, 3))).toMatchObject({
      status: 409,
      body: { error: 'revision_conflict' },
    });
  });
});
