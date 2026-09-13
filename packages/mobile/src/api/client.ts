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

/**
 * MUST be dot-notation, `process.env.EXPO_PUBLIC_API_URL` — not
 * `process.env['EXPO_PUBLIC_API_URL']`.
 *
 * Expo's Metro env-var inlining only rewrites the literal dot-access form; it
 * does not statically evaluate a computed/bracket member expression, even one
 * with a string-literal key, and explicitly documents bracket access as
 * unsupported. A bracket read here ships to the device bundle as literally
 * `process.env['EXPO_PUBLIC_API_URL']` — `process.env` on a released RN
 * bundle has no keys at all — so it evaluates to `undefined` on every real
 * device, and this always fell through to the localhost fallback below no
 * matter what `.env` said. That is a materially different bug from "reads the
 * wrong URL": it means the URL a physical device actually used was NEVER
 * configurable, on Home or Emergency alike, in any release build.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

/** Server responses are summaries; full state arrives over the Firestore listener. */
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
  /** Always false. See packages/server/src/routes/medications.ts for why. */
  readonly interactionsChecked: false;
  readonly interactionNotice: string;
}

/**
 * An emergency contact in the shape the server's notification layer expects.
 *
 * Sent WITH the confirmation rather than read from a stored profile, because
 * the medical profile is still device-local demo data. `phoneE164` is validated
 * server-side against a strict E.164 pattern: a local-format number is accepted
 * by Twilio's API and then silently never delivered, which is the worst kind of
 * failure this feature can have.
 */
export interface NotifiableContact {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly phoneE164: string;
  readonly whatsappEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly priority: number;
  /** May this person answer clinical questions on the patient's behalf (5.5)? */
  readonly canRelay: boolean;
}

export interface NotificationOutcome {
  readonly contactId: string;
  readonly channel: string;
  /** `suppressed` means composed but not sent - a dry run, or an opted-out contact. */
  readonly status: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed';
  readonly failureReason?: string;
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

  /**
   * Capability report. The app asks the SERVER what is available rather than
   * assuming — see the route's own comment for why that matters.
   */
  health: () =>
    request<{
      ok: boolean;
      firestoreEnabled: boolean;
      clinicalScorer: string;
      visionEnabled?: boolean;
      reasoningEnabled?: boolean;
      notificationsLive?: boolean;
    }>('/health'),

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

  /**
   * An injury photo, as a turn.
   *
   * `photoRef` is a base64 data URL — the server's vision adapter refuses a
   * bare reference, because an image the server cannot read is a wiring bug
   * rather than a model failure and should say so instead of calling the API.
   */
  submitPhoto: (caseId: CaseId, photoRef: string) =>
    request<TurnResponse>(`/cases/${caseId}/turns`, { kind: 'photo', photoRef }),

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
  confirm: (
    caseId: CaseId,
    heldMs: number,
    /**
     * Optional on purpose. A confirmation with no contacts still dispatches -
     * the routing decision must never depend on a notification list being
     * present - it simply tells nobody.
     */
    notify?: {
      readonly contacts: readonly NotifiableContact[];
      readonly patientName: string;
      /** Location rides on the same 3-second hold; never attached silently. */
      readonly shareLocation: boolean;
    },
  ) =>
    request<CaseSummary & { notifications: readonly NotificationOutcome[] }>(
      `/cases/${caseId}/confirm`,
      {
        heldMs,
        ...(notify === undefined
          ? {}
          : {
              contacts: notify.contacts,
              patientName: notify.patientName,
              shareLocation: notify.shareLocation,
            }),
      },
    ),

  cancel: (caseId: CaseId) => request<CaseSummary>(`/cases/${caseId}/cancel`),

  /**
   * Fetches the current case. The server's `GET /cases/:id` returns the full
   * `CaseState` document, a strict superset of `CaseSummary`'s fields — typed
   * as a summary here because that is all any caller of this method actually
   * reads, the same "the client only knows the shape it needs" boundary the
   * summary type draws everywhere else.
   *
   * Used only to seed a screen that is OPENING an already-existing case (the
   * assistant handing an in-progress conversation off to the full triage
   * view) rather than creating one — a screen that calls `createCase` has no
   * need for this.
   */
  getCase: (caseId: CaseId) => request<CaseSummary>(`/cases/${caseId}`),

  /**
   * Best-effort position report, for hospital matching (5.3).
   *
   * Nothing waits on this and nothing fails if it never happens - see
   * src/location/reportLocation.ts. `source` is recorded so a clinician
   * reading the case can tell a GPS fix from a number somebody typed in.
   */
  reportLocation: (
    caseId: CaseId,
    lat: number,
    lng: number,
    source: 'browser_geolocation' | 'manual_entry' | 'caregiver_report' = 'browser_geolocation',
  ) => request<{ ok: boolean }>(`/cases/${caseId}/location`, { lat, lng, source }),

  /**
   * Family Relay Mode (5.5) - ask a caregiver to take over the interview.
   *
   * Two calls, not one, and the split matters: `requestRelay` only sends the
   * invitation. The case does not claim a caregiver is answering until that
   * caregiver's own device calls `acceptRelay`, which is also what grants them
   * read access under the Firestore rules.
   */
  requestRelay: (
    caseId: CaseId,
    input: {
      readonly patientName: string;
      readonly contacts: readonly NotifiableContact[];
      readonly reason?: 'patient_unresponsive' | 'patient_requested' | 'minor_needs_adult';
      readonly silenceSeconds?: number;
      readonly shareLocation?: boolean;
    },
  ) =>
    request<{
      relay: { active: boolean; requestedAt?: string };
      invited: readonly string[];
      notifications: readonly NotificationOutcome[];
    }>(`/cases/${caseId}/relay/request`, input),

  /** Called from the CAREGIVER's device, with the caregiver's own uid. */
  acceptRelay: (caseId: CaseId, relayUid: string, contactId?: string) =>
    request<{ relay: { active: boolean }; mode: string; communicationState: string }>(
      `/cases/${caseId}/relay/accept`,
      { relayUid, ...(contactId === undefined ? {} : { contactId }) },
    ),

  /** RxNorm name normalisation. Never returns interaction data - see the route. */
  normalizeMedications: (names: readonly string[]) =>
    request<MedicationLookup>('/medications/normalize', { names }),
};
