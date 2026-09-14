/**
 * Shared HTTP plumbing for every real adapter.
 *
 * The point of this file is that each adapter below it contains ONLY the shape
 * of its own API - URL, response mapping - and none of the timeout, retry or
 * error-classification logic. That logic is identical everywhere and getting it
 * subtly different per adapter is how one tool ends up hanging for 30 seconds
 * while a patient waits.
 *
 * Timeouts come from DEFAULT_RETRY_POLICY in @triage/shared, which is
 * deliberately impatient (4s per attempt, 2 attempts): during an emergency
 * interview, a conservative fallback now beats a perfect answer in half a
 * minute.
 */

import { shouldRetry } from '@triage/shared';
import type { RetryPolicy, ToolError, ToolErrorKind } from '@triage/shared';

/**
 * Timeout budget for SUPPLEMENTARY lookups - knowledge, medication names,
 * diagnostic coding.
 *
 * Deliberately NOT DEFAULT_RETRY_POLICY. That policy's 4s ceiling exists for
 * the clinical scoring call, where a conservative fallback now genuinely beats
 * a correct answer in 30 seconds. These three tools are on no such critical
 * path: nothing about the risk tier, the routing decision or the safety gate
 * waits on them. Measured cold-start latency to NIH from here was ~3s on the
 * first request (DNS + TLS), which the 4s budget was clipping - producing
 * "degraded" banners for services that were working fine.
 *
 * Being impatient where it matters and patient where it does not is the whole
 * point; using one number for both gets one of the two wrong.
 */
export const SUPPLEMENTARY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  baseDelayMs: 250,
  maxDelayMs: 1000,
  timeoutMs: 9000,
};

/**
 * Wikimedia's API policy requires a descriptive User-Agent identifying the
 * application; requests without one are rate-limited to the point of being
 * unusable (verified: HTTP 429 on the very first call). NIH's services do not
 * require it but are happier with it, so it is sent everywhere.
 */
const USER_AGENT =
  'AdaptiveEmergencyTriageAgent/0.1 (hackathon project; https://github.com/panthangidheeraj-sudo/VITALIS)';

export interface HttpOutcome<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: ToolError;
  readonly latencyMs: number;
  readonly attempts: number;
}

/**
 * The URL with its query string removed, for use in error messages.
 *
 * NOT cosmetic. Gemini authenticates by query parameter — every vision call is
 * built as `...:generateContent?key=<GEMINI_API_KEY>` — so interpolating the
 * raw URL into a ToolError put the live API key inside a message that routes
 * then returned to the client. Verified against the running server: a Gemini
 * 429 came back to the caller with the key in plain text.
 *
 * The path alone is all the diagnostic value there ever was; the query string
 * is where the secrets live. Stripped here, once, rather than trusted to be
 * stripped again at each of the call sites that format an error.
 */
function safeUrl(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/** Maps a status code onto the closed ToolErrorKind set. */
function classify(status: number): { kind: ToolErrorKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: 'unauthorized', retryable: false };
  if (status === 429) return { kind: 'rate_limited', retryable: true };
  if (status >= 500) return { kind: 'server_error', retryable: true };
  if (status >= 400) return { kind: 'bad_request', retryable: false };
  return { kind: 'unavailable', retryable: true };
}

export interface RequestOptions {
  readonly headers?: Record<string, string>;
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
  readonly policy?: RetryPolicy;
}

/**
 * Performs a request with a hard per-attempt timeout, retrying only errors the
 * shared policy considers retryable, and returns the raw body text.
 *
 * Returns an outcome rather than throwing: every caller has to convert this
 * into a ToolResult anyway, and an exception would let a caller forget the
 * degradation notice that a failure is required to carry.
 */
export async function requestText(
  url: string,
  options: RequestOptions = {},
): Promise<HttpOutcome<string>> {
  const policy = options.policy ?? SUPPLEMENTARY_POLICY;
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: ToolError = {
    kind: 'unavailable',
    message: 'Request was never attempted.',
    retryable: false,
  };

  while (attempts < policy.maxAttempts) {
    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, ...(options.headers ?? {}) },
        ...(options.body === undefined ? {} : { body: options.body }),
      });

      if (!response.ok) {
        const { kind, retryable } = classify(response.status);
        lastError = {
          kind,
          message: `${safeUrl(url)} responded ${response.status}`,
          httpStatus: response.status,
          retryable,
        };
        if (!shouldRetry(lastError, attempts, policy)) break;
        continue;
      }

      return {
        ok: true,
        value: await response.text(),
        latencyMs: Date.now() - startedAt,
        attempts,
      };
    } catch (err) {
      // AbortError is how the timeout surfaces; everything else here is a
      // transport failure (DNS, TLS, connection reset).
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastError = {
        kind: aborted ? 'timeout' : 'network',
        message: aborted
          ? `${safeUrl(url)} exceeded ${policy.timeoutMs}ms`
          : `${safeUrl(url)}: ${err instanceof Error ? err.message : 'unknown transport error'}`,
        retryable: true,
      };
      if (!shouldRetry(lastError, attempts, policy)) break;
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError, latencyMs: Date.now() - startedAt, attempts };
}

/** As `requestText`, but parses JSON. A parse failure is an `invalid_response`. */
export async function requestJson<T>(
  url: string,
  options: RequestOptions = {},
): Promise<HttpOutcome<T>> {
  const outcome = await requestText(url, options);
  if (!outcome.ok || outcome.value === undefined) return outcome as HttpOutcome<T>;
  try {
    return { ...outcome, value: JSON.parse(outcome.value) as T };
  } catch {
    return {
      ok: false,
      error: {
        kind: 'invalid_response',
        message: `${safeUrl(url)} returned a body that is not valid JSON`,
        retryable: false,
      },
      latencyMs: outcome.latencyMs,
      attempts: outcome.attempts,
    };
  }
}

/**
 * Strips HTML tags and decodes the handful of entities these APIs actually
 * emit. Both MedlinePlus and the ICD-11 search wrap matched terms in markup
 * (`<span class="qt0">`, `<em class='found'>`), which would otherwise be read
 * aloud to a patient or printed on a doctor's handoff card verbatim.
 *
 * This is not a general-purpose HTML sanitiser and does not need to be - the
 * output is rendered as React Native <Text>, never as markup.
 */
export function stripMarkup(input: string): string {
  return (
    input
      // ORDER MATTERS. MedlinePlus returns its summaries as ESCAPED html inside
      // an XML element (`&lt;p&gt;`), so stripping tags before decoding leaves
      // the escaped ones untouched and they decode into visible `<p>` markup
      // afterwards. Decode first, then strip, so both real and escaped tags go.
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Block-level tags become a space: MedlinePlus separates paragraphs with
      // them and nothing else, so dropping them outright welds sentences
      // together ("...is sudden.Seek care if...").
      .replace(/<\/?(?:p|br|div|li|ul|ol|tr|td|h[1-6])\b[^>]*>/gi, ' ')
      // Everything else is inline highlighting - ICD-11 and MedlinePlus both
      // wrap matched words in <em>/<span>. These must vanish WITHOUT a space,
      // or "<em>pain</em>, unspecified" prints as "pain , unspecified".
      .replace(/<[^>]*>/g, '')
      // `&amp;` decodes last: doing it earlier would turn `&amp;lt;` into
      // `&lt;` and then into a tag delimiter that was never markup.
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Truncates at a sentence boundary where possible. Keeps handoff cards short. */
export function firstSentences(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastStop = cut.lastIndexOf('. ');
  return lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}...`;
}
