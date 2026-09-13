/**
 * Tool ports — the agent's entire contract with the outside world.
 *
 * The orchestrator in `packages/agent` depends ONLY on these interfaces. It
 * never imports an SDK, never sees an API key, and never knows whether it is
 * talking to Infermedica or to the local fallback scorer. That is what lets the
 * full Observe→Decide→Act→Evaluate→Adapt loop run and be tested today, with no
 * keys, and lets real adapters drop in later without touching loop logic.
 *
 * Note the role separation the spec insists on (§6): `ReasoningPort` (Groq)
 * has no method that returns a risk tier, and `RiskScoringPort` has no method
 * that returns prose. The model cannot score and the scorer cannot talk.
 */

import type {
  Citation,
  GeoPoint,
  IsoTimestamp,
  Language,
  Millis,
} from '../types/common.js';
import type { CaseId, ContactId, TurnId } from '../types/common.js';
import type { CaseState } from '../types/case-state.js';
import type { CommunicationRead } from '../types/communication.js';
import type { Contradiction } from '../types/confidence.js';
import type {
  ChoiceId,
  ConceptId,
  ConceptType,
  EvidenceItem,
  InfermedicaEvidence,
} from '../types/evidence.js';
import type { Hospital, HospitalSpecialty, PreArrivalSummary } from '../types/hospital.js';
import type { NotificationChannel, NotificationKind } from '../types/notification.js';
import type { BiologicalSex } from '../types/patient.js';
import type { RiskAssessment } from '../types/risk.js';
import type { SelectedQuestion } from '../types/turn.js';
import type { TimelineEntry } from '../types/timeline.js';
import type { ToolCallRecord } from '../types/tool-call.js';
import type { ToolResult } from './result.js';

// ---------------------------------------------------------------------------
// Clock — injected rather than ambient
// ---------------------------------------------------------------------------

/**
 * Wall time is a dependency like any other. Two concrete reasons here:
 *   - The §5.4 anchor trace (7:00 → 7:05) must be reproducible on camera for
 *     the demo video without anyone hand-editing timestamps.
 *   - Companion Mode's 2–5 minute reassessment loop is otherwise untestable
 *     without actually waiting minutes.
 */
export interface ClockPort {
  now(): IsoTimestamp;
  /** Monotonic milliseconds, for latency measurement. */
  monotonicMs(): Millis;
}

/** Stable id generation, injected so fixtures and tests are deterministic. */
export interface IdPort {
  newId(prefix: string): string;
}

// ---------------------------------------------------------------------------
// Clinical scoring — the ONLY source of a risk tier
// ---------------------------------------------------------------------------

export interface TriageRequest {
  readonly sex: BiologicalSex;
  readonly ageYears: number;
  readonly evidence: readonly InfermedicaEvidence[];
  /** Infermedica session id, so multi-turn calls are correlated on their side. */
  readonly interviewId?: string;
}

/**
 * Infermedica `/triage`, or the conservative local fallback.
 *
 * Returns a `RiskAssessment` whose `source` field says which engine ran. There
 * is no method here that accepts a tier — nothing can inject a risk level.
 */
export interface RiskScoringPort {
  score(request: TriageRequest): Promise<ToolResult<RiskAssessment>>;
}

// ---------------------------------------------------------------------------
// Evidence normalisation — free text to concept ids
// ---------------------------------------------------------------------------

/**
 * The step the original spec omitted: `/triage` accepts concept ids
 * (`s_*`, `p_*`), never free text. Everything the patient says must pass
 * through here before it can reach the scorer.
 */
export interface ParsedMention {
  readonly id: ConceptId;
  readonly type: ConceptType;
  readonly name: string;
  readonly commonName?: string;
  readonly choiceId: ChoiceId;
  /** The words in the input that produced this mention. */
  readonly orth: string;
}

export interface ParseRequest {
  readonly text: string;
  readonly ageYears: number;
  readonly sex?: BiologicalSex;
  /** Concept ids already established, for contextual disambiguation. */
  readonly context?: readonly ConceptId[];
  readonly conceptTypes?: readonly ConceptType[];
}

export interface EvidenceNormalizationPort {
  /** Infermedica `/parse`. Handles negation ("no cough" → `absent`). */
  parse(request: ParseRequest): Promise<ToolResult<readonly ParsedMention[]>>;
  /** Infermedica `/search`, for resolving a named concept the parser missed. */
  search(
    term: string,
    options: { readonly ageYears: number; readonly sex?: BiologicalSex },
  ): Promise<ToolResult<readonly ParsedMention[]>>;
}

// ---------------------------------------------------------------------------
// Reasoning — Groq. Selects and phrases. Never scores.
// ---------------------------------------------------------------------------

export interface QuestionSelectionRequest {
  readonly state: CaseState;
  /** Concepts the scoring engine would most benefit from resolving. */
  readonly candidateConceptIds: readonly ConceptId[];
  /** True when the Confidence Alert is live — demands hard-to-deflect phrasing. */
  readonly requireHardToDeflect: boolean;
  readonly language: Language;
}

export interface ContradictionCheckRequest {
  readonly state: CaseState;
  readonly newInputText: string;
  readonly newEvidence: readonly EvidenceItem[];
}

export interface PhotoObservation {
  /** What is visibly present — bleeding, swelling, burns, discolouration (§5.7). */
  readonly visibleSigns: readonly string[];
  readonly description: string;
  /** Concept ids the signs map onto, for normalisation. */
  readonly suggestedConceptTerms: readonly string[];
  /** 0..1. A blurry photo must not be treated as a measurement. */
  readonly imageQuality: number;
}

/**
 * Groq. Every method returns structure that a zod schema validates before it
 * can touch case state — the "verification gate" from §2. Note there is no
 * `assessRisk`, by design.
 */
export interface ReasoningPort {
  selectNextQuestion(
    request: QuestionSelectionRequest,
  ): Promise<ToolResult<SelectedQuestion>>;

  detectContradiction(
    request: ContradictionCheckRequest,
  ): Promise<ToolResult<readonly Contradiction[]>>;

  readCommunicationState(
    recentInputs: readonly string[],
    current: CommunicationRead,
  ): Promise<ToolResult<CommunicationRead>>;

  translate(
    text: string,
    to: Language,
    /** §8: preserve tone, not just literal meaning. */
    preserveTone: true,
  ): Promise<ToolResult<string>>;

  /** §5.7 — a vision tool call, not a trained classifier. */
  describeInjuryPhoto(
    imageRef: string,
  ): Promise<ToolResult<PhotoObservation>>;

  /** Renders the final patient-facing message under a tone directive. */
  composeResponse(request: {
    readonly state: CaseState;
    readonly intent: string;
    readonly maxSentenceWords: number;
    readonly language: Language;
  }): Promise<ToolResult<string>>;
}

// ---------------------------------------------------------------------------
// Knowledge, medication, coding
// ---------------------------------------------------------------------------

export interface Explanation {
  readonly text: string;
  readonly citation: Citation;
}

/** MedlinePlus — explains, cites. Cannot classify (§6). */
export interface KnowledgePort {
  explain(concept: { readonly name: string; readonly conceptId?: ConceptId }): Promise<
    ToolResult<Explanation>
  >;
}

export interface NormalizedMedication {
  readonly reportedName: string;
  readonly rxcui?: string;
  readonly normalizedName?: string;
  readonly interactionFlags: readonly string[];
}

/** RxNorm / RxNav. */
export interface MedicationPort {
  normalize(reportedNames: readonly string[]): Promise<ToolResult<readonly NormalizedMedication[]>>;
}

/** WHO ICD-11. Codes an already-derived category; does not diagnose (§6). */
export interface CodingPort {
  codeForCategory(input: {
    readonly chiefComplaint: string;
    readonly triageLevel: RiskAssessment['triageLevel'];
  }): Promise<ToolResult<{ readonly code: string; readonly title: string; readonly uri?: string }>>;
}

// ---------------------------------------------------------------------------
// Logistics
// ---------------------------------------------------------------------------

export interface HospitalSearchRequest {
  readonly origin: GeoPoint;
  readonly radiusKm: number;
  readonly requiredSpecialty?: HospitalSpecialty;
  readonly requireEmergencyDepartment: boolean;
  readonly limit: number;
}

/** OpenStreetMap for real coordinates, plus the simulated specialty/bed overlay. */
export interface HospitalPort {
  findNearby(request: HospitalSearchRequest): Promise<ToolResult<readonly Hospital[]>>;
  /** Pushes the pre-arrival packet to a simulated hospital endpoint (§5.3). */
  pushPreArrival(input: {
    readonly caseId: CaseId;
    readonly osmId: string;
    readonly payload: unknown;
  }): Promise<ToolResult<PreArrivalSummary>>;
}

export interface OutboundMessage {
  readonly contactId: ContactId;
  readonly toE164: string;
  readonly channel: NotificationChannel;
  readonly kind: NotificationKind;
  readonly body: string;
  readonly location?: GeoPoint;
}

/** Twilio. WhatsApp is the default channel; see notification.ts for why. */
export interface NotificationPort {
  send(message: OutboundMessage): Promise<ToolResult<{ readonly providerMessageId: string }>>;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Firestore. Writes are revision-checked: `expectedRevision` must match the
 * stored document or the write is rejected, so a Companion Mode tick and a
 * user answer arriving together cannot silently overwrite each other.
 */
export interface CaseStorePort {
  create(state: CaseState): Promise<void>;
  get(caseId: CaseId): Promise<CaseState | undefined>;

  /** Rejects with a revision-conflict error if the document has moved on. */
  update(
    caseId: CaseId,
    expectedRevision: number,
    next: CaseState,
  ): Promise<void>;

  appendTimeline(caseId: CaseId, entries: readonly TimelineEntry[]): Promise<void>;
  appendToolCall(caseId: CaseId, record: ToolCallRecord): Promise<void>;
  saveTurn(caseId: CaseId, turnId: TurnId, turn: unknown): Promise<void>;

  listTimeline(caseId: CaseId): Promise<readonly TimelineEntry[]>;
  listToolCalls(caseId: CaseId): Promise<readonly ToolCallRecord[]>;

  /**
   * Cases whose Companion Mode reassessment is due at or before `now` (5.4).
   *
   * OPTIONAL, because it is the one method here that is a QUERY rather than a
   * document operation, and not every store can answer it - a store backed by
   * something without secondary indexes would have to scan. A scheduler that
   * finds it absent must say Companion Mode is unavailable rather than quietly
   * never ticking, which is the failure this signature is shaped to prevent:
   * an absent method is a compile-time-visible capability gap, where a
   * `listAll()` that returned an empty array would look identical to a system
   * with no active cases.
   *
   * Implementations must filter on `companion.active` AND on the case still
   * being open - reassessing a cancelled case would contact people about an
   * emergency that is over.
   */
  listDueCompanionCases?(now: IsoTimestamp, limit: number): Promise<readonly CaseState[]>;
}

/** Raised by `CaseStorePort.update` when `expectedRevision` is stale. */
export class RevisionConflictError extends Error {
  constructor(
    readonly caseId: CaseId,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Case ${caseId}: expected revision ${expectedRevision}, found ${actualRevision}. ` +
        'Re-read the case and retry the turn.',
    );
    this.name = 'RevisionConflictError';
  }
}

// ---------------------------------------------------------------------------
// The full tool set handed to the orchestrator
// ---------------------------------------------------------------------------

export interface AgentTools {
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly risk: RiskScoringPort;
  readonly normalize: EvidenceNormalizationPort;
  readonly reasoning: ReasoningPort;
  readonly knowledge: KnowledgePort;
  readonly medication: MedicationPort;
  readonly coding: CodingPort;
  readonly hospitals: HospitalPort;
  readonly notifications: NotificationPort;
  readonly store: CaseStorePort;
}
