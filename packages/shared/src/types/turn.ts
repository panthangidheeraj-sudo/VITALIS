/**
 * A single pass of the Observe → Decide → Act → Evaluate → Adapt loop (§4).
 *
 * Spec §8 requires the agent to produce THREE parallel read-outs every turn —
 * risk tier, confidence level, communication state — all three feeding both
 * *what* is asked next and *how* it is phrased. Bundling them into one
 * required `TurnReadout` makes "we forgot to recompute confidence this turn"
 * a type error rather than a silent behavioural regression.
 */

import type { IsoTimestamp, Language, TurnId, ToolCallId } from './common.js';
import type { CommunicationRead } from './communication.js';
import type { ConfidenceState } from './confidence.js';
import type { EvidenceItem } from './evidence.js';
import type { RiskAssessment } from './risk.js';

/** The five loop phases, recorded so the demo video can show them firing in order. */
export const LOOP_PHASES = ['observe', 'decide', 'act', 'evaluate', 'adapt'] as const;
export type LoopPhase = (typeof LOOP_PHASES)[number];

/** All three axes, computed together, every turn. */
export interface TurnReadout {
  readonly risk: RiskAssessment;
  readonly confidence: ConfidenceState;
  readonly communication: CommunicationRead;
}

/** What the Decide phase chose to do next. */
export type NextAction =
  /** Ask one more question — evidence is still too thin or too shaky to score. */
  | 'ask_question'
  /** Enough evidence: call the deterministic scoring tool. */
  | 'score_now'
  /**
   * A contradiction fired. Re-question with harder-to-deflect phrasing before
   * anything is finalised. This is the Adapt branch made explicit.
   */
  | 'probe_contradiction'
  /** Policy is satisfied — propose a routing outcome behind its gate. */
  | 'propose_routing'
  /** Hand off to a human; do not guess. */
  | 'escalate';

/** The question the agent selected, with everything needed to render it well. */
export interface SelectedQuestion {
  /** Rendered text, already tone- and language-adjusted. */
  readonly text: string;
  /** Concept(s) this question is trying to resolve. Ties a question to its purpose. */
  readonly targetConceptIds: readonly string[];
  /** Why this question and not another — shown in the reasoning panel (§9). */
  readonly rationale: string;
  /**
   * Expected information gain, 0..1. The problem statement's "minimise
   * unnecessary questioning" requirement is only auditable if the agent records
   * what it expected to learn.
   */
  readonly expectedInformationGain: number;
  /** Offered answers, when the question is closed-form. */
  readonly choices?: readonly { readonly id: string; readonly label: string }[];
  readonly language: Language;
  /** True when phrased to be hard to brush off (terse speaker / active contradiction). */
  readonly hardToDeflect: boolean;
}

/** Raw input that opened the turn (the Observe phase). */
export interface TurnInput {
  readonly kind: 'text' | 'voice_transcript' | 'photo' | 'quick_select' | 'vital' | 'system_tick';
  readonly text?: string;
  /** Storage reference for an uploaded injury photo (§5.7). Never the raw bytes. */
  readonly photoRef?: string;
  readonly quickSelectTags?: readonly string[];
  readonly language?: Language;
  /** Set when a caregiver, not the patient, produced this input (§5.5). */
  readonly fromCaregiver?: boolean;
  readonly receivedAt: IsoTimestamp;
}

export interface Turn {
  readonly id: TurnId;
  /** Monotonic, starting at 0. */
  readonly index: number;

  readonly input: TurnInput;
  /** New evidence extracted this turn, after normalisation through `/parse`. */
  readonly extractedEvidence: readonly EvidenceItem[];

  /** All three axes, recomputed. */
  readonly readout: TurnReadout;

  readonly decidedAction: NextAction;
  /** Present when `decidedAction` is `ask_question` or `probe_contradiction`. */
  readonly question?: SelectedQuestion;

  /** Every external call this turn made, in order. The tool-interaction evidence. */
  readonly toolCallIds: readonly ToolCallId[];

  /**
   * Set when this turn changed the plan mid-flow — a contradiction appeared, a
   * new symptom arrived, risk moved. This flag is what the demo video points at
   * for the Adaptation beat.
   */
  readonly adaptation?: AdaptationRecord;

  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp;
}

/** Why the agent changed course, in terms a judge can read off the screen. */
export type AdaptationTrigger =
  | 'new_symptom_reported'
  | 'symptom_worsened'
  | 'contradiction_detected'
  | 'risk_tier_changed'
  | 'confidence_dropped'
  | 'patient_stopped_responding'
  | 'caregiver_took_over'
  | 'tool_unavailable'
  | 'photo_observation_added';

export interface AdaptationRecord {
  readonly trigger: AdaptationTrigger;
  /** What the agent was about to do. */
  readonly plannedAction: NextAction;
  /** What it did instead. */
  readonly revisedAction: NextAction;
  readonly explanation: string;
  readonly at: IsoTimestamp;
}
