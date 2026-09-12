/**
 * Client for the Express orchestrator.
 *
 * The app WRITES through this and READS through Firestore listeners. That split
 * is the §3.1 architecture: all credentials and all orchestration stay
 * server-side, and the phone learns about results by observing state rather
 * than by holding a connection open.
 *
 * ── THE THING THAT WILL WASTE AN HOUR IF YOU DO NOT KNOW IT ──────────────────
 * `localhost` on a physical phone means THE PHONE, not your laptop. Running the
 * app in Expo Go on a real device with EXPO_PUBLIC_API_URL=http://localhost:8787
 * fails with an opaque network error. Set it to the laptop's LAN address —
 * `http://192.168.x.x:8787` — with both devices on the same Wi-Fi. The Expo CLI
 * prints that address when it starts.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { BiologicalSex, CaseId, Language, RiskTier, RoutingDecision } from '@triage/shared';

const BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:8787';

/** Server responses are summaries; full state arrives over the Firestore listener. */
export interface CaseSummary {
  readonly caseId: CaseId;
  readonly revision: number;
  readonly status: string;
  readonly riskTier: RiskTier;
  readonly triageLevel: string;
  readonly scoringSource: 'infermedica' | 'local_fallback';
  readonly degraded: boolean;
  readonly degradationNotice?: string;
  readonly confidence: { readonly score: number; readonly level: string };
  readonly confidenceAlertActive: boolean;
  readonly communicationState: string;
  readonly turnCount: number;
  readonly routing?: RoutingDecision;
  readonly dispatch: { readonly status: string; readonly etaMinutes?: number; readonly contactNumber?: string };
  readonly escalation: { readonly escalated: boolean; readonly detail?: string };
}

export interface TurnResponse extends CaseSummary {
  readonly turn: {
    readonly id: string;
    readonly index: number;
    readonly decidedAction: string;
    readonly question?: { readonly text: string; readonly rationale: string; readonly hardToDeflect: boolean };
    readonly adaptation?: { readonly trigger: string; readonly explanation: string };
    readonly extractedEvidence: number;
    readonly toolCallCount: number;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    // Almost always the localhost-vs-LAN-IP mistake described above, so the
    // message says so rather than just "Network request failed".
    throw new ApiError(
      0,
      'network_unreachable',
      `Could not reach the orchestrator at ${BASE_URL}. ` +
        'On a physical device this must be your computer\'s LAN IP, not localhost.',
    );
  }

  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof parsed['error'] === 'string' ? parsed['error'] : 'unknown_error',
      typeof parsed['message'] === 'string' ? parsed['message'] : `Request failed (${response.status})`,
    );
  }
  return parsed as T;
}

export const api = {
  baseUrl: BASE_URL,

  health: () => request<{ ok: boolean; firestoreEnabled: boolean; clinicalScorer: string }>('/health'),

  createCase: (input: {
    /** Anonymous-auth uid; the server stores it as `CaseState.ownerUid`. */
    ownerUid: string;
    ageYears: number;
    sex: BiologicalSex;
    language?: Language;
    displayName?: string;
  }) => request<CaseSummary>('/cases', input),

  submitText: (caseId: CaseId, text: string, fromCaregiver = false) =>
    request<TurnResponse>(`/cases/${caseId}/turns`, { kind: 'text', text, fromCaregiver }),

  submitQuickSelect: (caseId: CaseId, tags: readonly string[]) =>
    request<TurnResponse>(`/cases/${caseId}/turns`, {
      kind: 'quick_select',
      quickSelectTags: tags,
    }),

  /**
   * `heldMs` is how long the user actually held the confirm control. The server
   * re-checks it against the policy's required duration — the client does not
   * get to declare the gate satisfied.
   */
  confirm: (caseId: CaseId, heldMs: number) =>
    request<CaseSummary>(`/cases/${caseId}/confirm`, { heldMs }),

  cancel: (caseId: CaseId) => request<CaseSummary>(`/cases/${caseId}/cancel`),
};
