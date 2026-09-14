/**
 * The persistent case-state object (§4) — the document at `cases/{caseId}`.
 *
 * This is the single thing that most separates the system from a chatbot. It is
 * not conversation history; it is a structured clinical case that survives
 * reloads, is shared live between the patient's screen and a caregiver's, and
 * can be handed to a clinician as-is.
 *
 * Turns, timeline entries and tool calls live in SUBCOLLECTIONS, not in arrays
 * on this document. Firestore caps a document at 1 MiB and, more importantly,
 * a document under contention serialises writes — Companion Mode reassessing
 * every 2–5 minutes while a caregiver answers questions would collide. See
 * `firestore/paths.ts`.
 */

import type {
  CaseId,
  GeoFix,
  IsoTimestamp,
  Language,
  Millis,
  PatientId,
  TurnId,
  Uid,
} from './common.js';
import type { CommunicationRead } from './communication.js';
import type { ConfidenceState } from './confidence.js';
import type { EvidenceItem } from './evidence.js';
import type { HospitalMatch, PreArrivalSummary } from './hospital.js';
import type { InjuryTracking } from './injury.js';
import type { NotificationRecord, RelayState } from './notification.js';
import type { EmergencyCard, PatientDemographics, VitalReading } from './patient.js';
import type { RiskAssessment } from './risk.js';
import type { DispatchState, RoutingDecision } from './routing.js';

/** Which of the three operating modes the case is in (§5.4, §5.5). */
export const CASE_MODES = [
  /** The patient is answering for themselves. Default. */
  'patient',
  /** A caregiver is answering on the patient's behalf (§5.5). */
  'family_relay',
  /** Triage is done; the agent is monitoring and reassessing periodically (§5.4). */
  'companion',
] as const;
export type CaseMode = (typeof CASE_MODES)[number];

export type CaseStatus =
  /** Interview in progress. */
  | 'interviewing'
  /** A routing outcome has been proposed and is waiting on its safety gate. */
  | 'awaiting_confirmation'
  /** Confirmed; action taken; monitoring continues. */
  | 'action_taken'
  /** Handed to a human because the agent would not guess (§1). */
  | 'escalated'
  /** Closed normally. */
  | 'resolved'
  /** User cancelled the alert (§5.2). */
  | 'cancelled';

/** §1 / §5.1 — escalation is a deliberate outcome, recorded with its reason. */
export interface EscalationState {
  readonly escalated: boolean;
  readonly reason?:
    | 'unresolved_contradiction_high_risk'
    | 'confidence_too_low_to_route'
    | 'clinical_scoring_unavailable'
    | 'patient_unresponsive'
    | 'explicit_user_request'
    | 'repeated_tool_failure';
  readonly detail?: string;
  readonly at?: IsoTimestamp;
}

/** Companion Mode bookkeeping (§5.4). */
export interface CompanionState {
  readonly active: boolean;
  /** Spec says every 2–5 minutes. */
  readonly intervalMs: Millis;
  readonly lastReassessedAt?: IsoTimestamp;
  readonly nextReassessmentDueAt?: IsoTimestamp;
  readonly reassessmentCount: number;
  /** Trend on the three signs the spec names. */
  readonly trends: {
    readonly breathing?: 'worsening' | 'stable' | 'improving';
    readonly consciousness?: 'worsening' | 'stable' | 'improving';
    readonly bleeding?: 'worsening' | 'stable' | 'improving';
  };
  /** First-aid content currently surfaced, matched to the present state. */
  readonly activeFirstAidTopic?: string;
}

export const COMPANION_DEFAULT_INTERVAL_MS: Millis = 3 * 60 * 1000;

/**
 * Degradation currently in effect across the tool layer. Drives the UI banner.
 * §6: the assistant must say so explicitly rather than silently degrading.
 */
export interface DegradationState {
  readonly clinicalScoringDegraded: boolean;
  /** The exact sentence shown to the user. */
  readonly notice?: string;
  readonly since?: IsoTimestamp;
  readonly affectedTools: readonly string[];
}

export interface CaseState {
  readonly caseId: CaseId;
  readonly schemaVersion: 1;
  /**
   * Optimistic-concurrency counter. Incremented on every write. A turn that
   * reads revision N must write N+1 or be rejected — otherwise a Companion
   * Mode tick and a user answer landing together can silently clobber one
   * another, which in this domain means losing a symptom.
   */
  readonly revision: number;

  /**
   * The Firebase Auth uid that opened this case, and the only identity the
   * security rules will read it back to (plus `relayUids`).
   *
   * REQUIRED, deliberately. It would be easier to make this optional and avoid
   * touching every construction site, but a case written without an owner is
   * not readable by ANY client under firebase/firestore.rules — the listener
   * simply returns nothing, with no error the UI can show. Making the field
   * mandatory turns that into a compile error instead of a silent dead screen
   * during a demo.
   *
   * It is set by the SERVER from the value the client supplies at case
   * creation. That is not a trust boundary being crossed: a client can only
   * name a uid it already knows, and naming someone else's uid would give away
   * access rather than gain it. Verifying an ID token here would be stricter,
   * and is the obvious hardening step if this ever left a hackathon.
   */
  readonly ownerUid: Uid;

  /**
   * Caregivers granted read access under Family Relay Mode (§5.5). Optional
   * because the overwhelming majority of cases never have one, and the rules
   * read it with a default (`caseData.get('relayUids', [])`) so an absent
   * field is not an error there either.
   */
  readonly relayUids?: readonly Uid[];

  readonly status: CaseStatus;
  readonly mode: CaseMode;
  readonly language: Language;

  readonly patientId?: PatientId;
  readonly demographics: PatientDemographics;
  /** Snapshot taken at case open, so the handoff card is stable if the profile changes. */
  readonly emergencyCard?: EmergencyCard;
  readonly vitals: readonly VitalReading[];

  /** Append-only with supersession. See `evidence.ts`. */
  readonly evidence: readonly EvidenceItem[];

  // --- The three axes, always current -------------------------------------
  readonly risk: RiskAssessment;
  readonly confidence: ConfidenceState;
  readonly communication: CommunicationRead;

  /** Id of the most recent turn; the turn itself lives in the subcollection. */
  readonly lastTurnId?: TurnId;
  readonly turnCount: number;

  readonly routing?: RoutingDecision;
  readonly dispatch: DispatchState;
  readonly hospital?: HospitalMatch;
  readonly preArrival?: PreArrivalSummary;

  readonly relay: RelayState;
  readonly companion: CompanionState;
  readonly escalation: EscalationState;
  readonly degradation: DegradationState;

  readonly notifications: readonly NotificationRecord[];
  readonly lastKnownLocation?: GeoFix;

  /**
   * Appearance tracking for injury photos (§5.7). Absent until a photo has
   * been submitted. Deliberately NOT part of `risk` — see types/injury.ts for
   * why the two must stay separate fields.
   */
  readonly injury?: InjuryTracking;

  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly closedAt?: IsoTimestamp;
}

/** Still being worked — as opposed to closed, cancelled or handed off. */
export function isCaseActive(state: Pick<CaseState, 'status'>): boolean {
  return (
    state.status === 'interviewing' ||
    state.status === 'awaiting_confirmation' ||
    state.status === 'action_taken'
  );
}

/**
 * True when the agent must NOT finalise a routing decision: a Confidence Alert
 * is live, or an unresolved contradiction sits on the record. Checked by the
 * policy layer before any outcome is proposed (§5.1).
 */
export function mustResolveBeforeRouting(
  state: Pick<CaseState, 'confidence'>,
): boolean {
  return (
    state.confidence.alertActive ||
    state.confidence.contradictions.some((c) => c.resolvedAt === undefined)
  );
}
