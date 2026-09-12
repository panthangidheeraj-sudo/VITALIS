/**
 * The envelope every external tool call returns.
 *
 * Spec §6, the "no oops" rule:
 *
 *   "If any clinical-layer API call fails or is rate-limited, the assistant
 *    must say so explicitly rather than silently degrading... Never present a
 *    lower-confidence result as if it were full clinical-engine output."
 *
 * Making that a discipline would guarantee it eventually gets skipped. Instead
 * it is a type: the `fallback` variant CANNOT be constructed without a
 * `DegradationNotice`, and that notice carries the exact sentence shown to the
 * user. The UI banner, the timeline entry and the handoff card all read the
 * same field, so there is no code path that produces a fallback result and
 * forgets to mention it.
 */

import type { Citation, Millis } from '../types/common.js';

export type ToolErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'rate_limited'
  /** The Infermedica trial's hard cap on /triage specifically. */
  | 'quota_exceeded'
  | 'bad_request'
  /** Response did not match the expected schema — the verification gate tripped. */
  | 'invalid_response'
  | 'server_error'
  | 'unavailable';

export interface ToolError {
  readonly kind: ToolErrorKind;
  readonly message: string;
  readonly httpStatus?: number;
  /** Whether a retry could plausibly succeed. Drives the retry policy. */
  readonly retryable: boolean;
}

/**
 * A degradation that must be surfaced to the user verbatim.
 *
 * `userFacingMessage` is written in the assistant's voice (§7: straightforward,
 * no hedging filler) and is displayed as-is — it is not a hint for a model to
 * paraphrase later, because paraphrasing is how "unavailable" quietly becomes
 * "everything's fine".
 */
export interface DegradationNotice {
  readonly tool: string;
  readonly reason: ToolErrorKind;
  /** Shown to the user exactly as written. e.g. the §6 example sentence. */
  readonly userFacingMessage: string;
  /** What was used instead. */
  readonly fallbackUsed: string;
  /**
   * Whether the fallback is conservative (rounds toward more care). Clinical
   * fallbacks must always be true — never route someone down on degraded data.
   */
  readonly conservative: boolean;
}

export type ToolResult<T> =
  | {
      readonly ok: true;
      readonly source: 'live';
      readonly data: T;
      readonly latencyMs: Millis;
      readonly citation?: Citation;
    }
  | {
      readonly ok: true;
      readonly source: 'fallback';
      readonly data: T;
      readonly latencyMs: Millis;
      /** Required on this variant. Not optional, by construction. */
      readonly degraded: DegradationNotice;
      readonly citation?: Citation;
    }
  | {
      readonly ok: false;
      readonly source: 'failed';
      readonly error: ToolError;
      readonly latencyMs: Millis;
      readonly degraded: DegradationNotice;
    };

// --- Constructors ------------------------------------------------------------

export function liveResult<T>(
  data: T,
  latencyMs: Millis,
  citation?: Citation,
): ToolResult<T> {
  return citation === undefined
    ? { ok: true, source: 'live', data, latencyMs }
    : { ok: true, source: 'live', data, latencyMs, citation };
}

export function fallbackResult<T>(
  data: T,
  latencyMs: Millis,
  degraded: DegradationNotice,
): ToolResult<T> {
  return { ok: true, source: 'fallback', data, latencyMs, degraded };
}

export function failedResult<T>(
  error: ToolError,
  latencyMs: Millis,
  degraded: DegradationNotice,
): ToolResult<T> {
  return { ok: false, source: 'failed', error, latencyMs, degraded };
}

// --- Guards ------------------------------------------------------------------

export function isDegraded<T>(result: ToolResult<T>): boolean {
  return result.source !== 'live';
}

/** The notice to surface, if any. Returns undefined only for clean live results. */
export function degradationOf<T>(result: ToolResult<T>): DegradationNotice | undefined {
  return result.source === 'live' ? undefined : result.degraded;
}

// --- Retry policy ------------------------------------------------------------

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: Millis;
  readonly maxDelayMs: Millis;
  /** Per-attempt ceiling. An emergency interview cannot wait 30s on a tool. */
  readonly timeoutMs: Millis;
}

/**
 * Deliberately impatient. This runs while someone may be having a heart
 * attack; falling back to the conservative local scorer in 4 seconds beats a
 * correct Infermedica answer in 30.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  baseDelayMs: 250,
  maxDelayMs: 1000,
  timeoutMs: 4000,
};

/** Quota exhaustion never benefits from a retry — go straight to the fallback. */
export function shouldRetry(error: ToolError, attempt: number, policy: RetryPolicy): boolean {
  if (attempt >= policy.maxAttempts) return false;
  if (error.kind === 'quota_exceeded' || error.kind === 'unauthorized') return false;
  return error.retryable;
}
