/**
 * Client for the Express orchestrator — the web equivalent of
 * packages/mobile/src/api/client.ts, deliberately kept to the SAME contract
 * (same paths, same request/response shapes) rather than inventing a new
 * one, per the brief. Differences from the mobile client are called out
 * where they happen; everything else is a direct port.
 *
 * `import.meta.env.VITE_API_URL` is Vite's equivalent of Expo's
 * `EXPO_PUBLIC_*` — inlined at build time, safe to expose (it is just an
 * address), and the ONLY server URL this app ever talks to. No Groq/Gemini/
 * Twilio/ICD-11/Firebase-admin credential is imported, read, or referenced
 * anywhere in packages/web — those stay server-side, same as the mobile app.
 */

import type { BiologicalSex, CaseId, Hospital, RiskTier, RoutingDecision } from '@triage/shared';

const RAW_ENV_URL = import.meta.env.VITE_API_URL as string | undefined;
const BASE_URL = RAW_ENV_URL ?? 'http://localhost:8787';

// Loud, not silent — same reasoning as the mobile client's own version of
// this: a missing env var falling back to localhost fails with a generic
// network error days later with nothing pointing at the cause.
if (import.meta.env.DEV) {
  if (RAW_ENV_URL === undefined) {
    console.warn(
      '[vitalis] VITE_API_URL is not set — falling back to ' +
        `${BASE_URL}. Set VITE_API_URL in packages/web/.env to your deployed backend ` +
        '(e.g. https://vitalis-88at.onrender.com), then restart the dev server.',
    );
  } else {
    console.log(`[vitalis] API base URL: ${BASE_URL}`);
  }
}

export interface CaseSummary {
  readonly caseId: CaseId;
  readonly revision: number;
  readonly status: string;
  readonly riskTier: RiskTier;
  readonly triageLevel: string;
  readonly scoringSource: 'local_rules' | 'infermedica' | 'local_fallback';
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

export interface MedicationLookup {
  readonly medications: readonly {
    readonly reportedName: string;
    readonly rxcui?: string;
    readonly normalizedName?: string;
  }[];
  readonly verified: boolean;
  readonly degradationNotice?: string;
  readonly interactionsChecked: false;
  readonly interactionNotice: string;
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
  } catch {
    throw new ApiError(
      0,
      'network_unreachable',
      `Could not reach the orchestrator at ${BASE_URL}. Check VITE_API_URL and that the backend is running.`,
    );
  }

  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // A non-JSON body (an HTML error/gateway page) reaching this far means
    // something answered, just not the orchestrator — see the mobile
    // client's identical guard for the incident that made this necessary.
    throw new ApiError(
      response.status,
      'invalid_response',
      `${BASE_URL} did not return JSON (got ${response.status}). Check VITE_API_URL.`,
    );
  }

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

  health: () =>
    request<{
      ok: boolean;
      firestoreEnabled: boolean;
      clinicalScorer: string;
      visionEnabled?: boolean;
      reasoningEnabled?: boolean;
      generalChatEnabled?: boolean;
      notificationsLive?: boolean;
    }>('/health'),

  createCase: (input: { ownerUid: string; ageYears: number; sex: BiologicalSex; displayName?: string }) =>
    request<CaseSummary>('/cases', input),

  submitText: (caseId: CaseId, text: string) =>
    request<TurnResponse>(`/cases/${caseId}/turns`, { kind: 'text', text }),

  submitQuickSelect: (caseId: CaseId, tags: readonly string[]) =>
    request<TurnResponse>(`/cases/${caseId}/turns`, { kind: 'quick_select', quickSelectTags: tags }),

  /** No `contacts`/`patientName` — the web app has no profile/contacts UI (out
   * of scope for this pass); the server allows a confirm with neither, and
   * still dispatches — it just tells nobody. */
  confirm: (caseId: CaseId, heldMs: number) =>
    request<CaseSummary>(`/cases/${caseId}/confirm`, { heldMs, shareLocation: false }),

  cancel: (caseId: CaseId) => request<CaseSummary>(`/cases/${caseId}/cancel`),

  reportLocation: (caseId: CaseId, lat: number, lng: number) =>
    request<{ ok: boolean }>(`/cases/${caseId}/location`, { lat, lng, source: 'browser_geolocation' }),

  nearbyHospitals: (lat: number, lng: number, radiusKm = 10, limit = 5) =>
    request<{ hospitals: readonly Hospital[] }>(
      `/hospitals/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}&limit=${limit}`,
    ),

  normalizeMedications: (names: readonly string[]) =>
    request<MedicationLookup>('/medications/normalize', { names }),

  assistantChat: (message: string, history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]) =>
    request<{
      readonly reply: string;
      readonly citation?: { readonly provider?: string; readonly title?: string; readonly url?: string };
    }>('/assistant/chat', { message, history }),
};

/** A per-browser anonymous id, the web equivalent of the mobile app's
 * Firebase-anonymous-auth `resolveOwnerUid()`. No Firebase here — this is
 * just a stable random id kept in localStorage so the same browser reuses
 * one identity across cases, which is all `ownerUid` is used for when
 * Firestore isn't in the loop. */
export function resolveOwnerUid(): string {
  const KEY = 'vitalis.ownerUid';
  const existing = localStorage.getItem(KEY);
  if (existing !== null) return existing;
  const id = `web_${crypto.randomUUID()}`;
  localStorage.setItem(KEY, id);
  return id;
}
