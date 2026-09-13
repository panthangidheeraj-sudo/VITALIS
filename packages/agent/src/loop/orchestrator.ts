/**
 * The Observe -> Decide -> Act -> Evaluate -> Adapt loop (spec §4).
 *
 * `orchestrateTurn` is a single pass: one piece of input in, one updated case
 * state out, plus the turn record, the timeline entries it produced, and the
 * tool-call ledger for everything it touched. It is deliberately NOT
 * responsible for persistence or concurrency — see `run-turn.ts` for the
 * revision-checked write. That split is what makes this function testable
 * against plain objects and mock tools, with no store and no network.
 *
 * Phase map, for orientation:
 *   OBSERVE   — turn input + case history -> new EvidenceItems
 *   (cross-cutting: communication read, contradiction detection — both are
 *    facts ABOUT the observation, computed right after it)
 *   ACT       — if there is enough evidence, call the clinical scoring tool
 *   EVALUATE  — check the result against policy thresholds; check whether
 *               routing may be finalised at all; check for escalation
 *   ADAPT     — if a contradiction, new symptom, or tier change appeared,
 *               record the re-plan and select a harder question OR propose
 *               routing instead of continuing on the pre-turn plan
 */

import type {
  AdaptationRecord,
  AdaptationTrigger,
  AgentTools,
  CaseState,
  CommunicationRead,
  Contradiction,
  EvidenceItem,
  IsoTimestamp,
  NextAction,
  RiskAssessment,
  RoutingDecision,
  SelectedQuestion,
  TimelineEntry,
  ToolCallRecord,
  Turn,
  TurnId,
  TurnInput,
} from '@triage/shared';
import {
  activeEvidence,
  asTimelineEntryId,
  asTurnId,
  allowedRoutingOutcomes,
  canFinalizeRouting,
  isEscalation,
  MIN_EVIDENCE_TO_SCORE,
  mustEscalateUnresolved,
  readyToScore,
  recommendOutcome,
  requiredGate,
  toInfermedicaEvidence,
  verifyDecision,
} from '@triage/shared';
import { applyEvidence, type NewEvidenceInput } from '../evidence/apply-evidence.js';
import { computeConfidence } from '../confidence/confidence-policy.js';
import { mergeContradictions, resolveContradictions } from '../contradiction/resolve.js';
import { resolveQuickSelectTag } from '../quick-select.js';
import { callTool, type CallToolContext } from './ledger.js';

export interface OrchestrateTurnResult {
  readonly nextState: CaseState;
  readonly turn: Turn;
  readonly timeline: readonly TimelineEntry[];
  readonly toolCalls: readonly ToolCallRecord[];
}

function mkEntry(
  ids: AgentTools['ids'],
  at: IsoTimestamp,
  partial: Omit<TimelineEntry, 'id' | 'recordedAt' | 'at'>,
): TimelineEntry {
  return { id: asTimelineEntryId(ids.newId('tl')), at, recordedAt: at, ...partial };
}

// ---------------------------------------------------------------------------
// OBSERVE
// ---------------------------------------------------------------------------

async function observe(
  state: CaseState,
  input: TurnInput,
  tools: AgentTools,
  turnId: TurnId,
  ctx: CallToolContext,
): Promise<{ evidence: readonly EvidenceItem[]; added: readonly EvidenceItem[] }> {
  const { ageYears, sex } = state.demographics;
  const isFirstTurn = state.turnCount === 0;
  const reportSource = input.fromCaregiver === true ? 'caregiver_report' : isFirstTurn ? 'initial_complaint' : 'question_answer';
  const reportReliability = input.fromCaregiver === true ? 'measured' : 'reported';

  const toInputs = (
    mentions: readonly { id: string; type: string; name: string; commonName?: string; choiceId: string }[],
    source: NewEvidenceInput['source'],
    reliability: NewEvidenceInput['reliability'],
    rawText: string | undefined,
  ): NewEvidenceInput[] =>
    mentions.map((m) => ({
      conceptId: m.id,
      conceptType: m.type as NewEvidenceInput['conceptType'],
      name: m.name,
      ...(m.commonName !== undefined ? { commonName: m.commonName } : {}),
      choiceId: m.choiceId as NewEvidenceInput['choiceId'],
      source,
      reliability,
      ...(rawText !== undefined ? { rawText } : {}),
      turnId,
    }));

  let inputs: NewEvidenceInput[] = [];

  if ((input.kind === 'text' || input.kind === 'voice_transcript') && input.text !== undefined) {
    const result = await callTool(ctx, 'infermedica.parse', `text(${input.text.length} chars)`, () =>
      tools.normalize.parse({
        text: input.text!,
        ageYears,
        sex,
        context: activeEvidence(state.evidence).map((e) => e.conceptId),
      }),
    );
    if (result.ok) {
      inputs = toInputs(result.data, reportSource, reportReliability, input.text);
    }
  }

  if (input.kind === 'quick_select' && input.quickSelectTags !== undefined) {
    for (const tag of input.quickSelectTags) {
      const resolved = resolveQuickSelectTag(tag);
      if (resolved === undefined) continue;
      inputs.push({
        conceptId: resolved.conceptId,
        conceptType: resolved.conceptType,
        name: resolved.name,
        commonName: resolved.commonName,
        choiceId: 'present',
        source: 'quick_select_tag',
        reliability: 'reported',
        rawText: resolved.commonName,
        turnId,
      });
    }
  }

  if (input.kind === 'photo' && input.photoRef !== undefined) {
    const photoResult = await callTool(ctx, 'groq.describe_injury_photo', `photoRef=${input.photoRef}`, () =>
      tools.reasoning.describeInjuryPhoto(input.photoRef!),
    );
    if (photoResult.ok && photoResult.data.imageQuality >= 0.3) {
      // Cap at two terms — each is its own tool call, and this is one photo
      // being turned into evidence, not an open-ended search spree.
      for (const term of photoResult.data.suggestedConceptTerms.slice(0, 2)) {
        const searchResult = await callTool(ctx, 'infermedica.search', `term="${term}"`, () =>
          tools.normalize.search(term, { ageYears, sex }),
        );
        if (searchResult.ok && searchResult.data.length > 0) {
          const best = searchResult.data[0]!;
          inputs.push({
            conceptId: best.id,
            conceptType: best.type,
            name: best.name,
            ...(best.commonName !== undefined ? { commonName: best.commonName } : {}),
            choiceId: 'present',
            source: 'photo_observation',
            reliability: 'inferred',
            rawText: photoResult.data.description,
            turnId,
          });
        }
      }
    }
  }

  const { evidence, added } = applyEvidence(state.evidence, inputs, tools.clock.now(), tools.ids);
  return { evidence, added };
}

// ---------------------------------------------------------------------------
// The full loop
// ---------------------------------------------------------------------------

export async function orchestrateTurn(
  state: CaseState,
  input: TurnInput,
  tools: AgentTools,
): Promise<OrchestrateTurnResult> {
  const turnId = asTurnId(tools.ids.newId('turn'));
  const timeline: TimelineEntry[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const now = tools.clock.now();
  const phaseCtx = (phase: CallToolContext['phase']): CallToolContext => ({
    clock: tools.clock,
    ids: tools.ids,
    turnId,
    phase,
    toolCalls,
    timeline,
  });

  // Baseline: what would the agent have done if nothing new arrived this
  // turn? Used purely to detect and narrate an adaptation — see the ADAPT
  // section below. Computed from pre-turn state, before any observation.
  const priorGate = canFinalizeRouting({
    confidence: state.confidence,
    activeEvidenceCount: activeEvidence(state.evidence).length,
  });
  const priorPlannedAction: NextAction = priorGate.blocked
    ? priorGate.requiredAction
    : readyToScore(activeEvidence(state.evidence).length)
      ? 'score_now'
      : 'ask_question';

  // --- OBSERVE ---------------------------------------------------------------
  const { evidence, added } = await observe(state, input, tools, turnId, phaseCtx('observe'));

  if (input.kind === 'vital') {
    // Vitals are recorded on the case directly; this build does not attempt
    // to synthesise clinical evidence from a raw number (e.g. "SpO2 93 ->
    // s_hypoxia") without a verified concept mapping. See README open items.
  }

  // --- Communication read (a fact about the input, computed right after it) --
  const rawTexts = [input.text, ...added.map((e) => e.rawText)].filter(
    (t): t is string => t !== undefined,
  );
  let communication: CommunicationRead = state.communication;
  if (rawTexts.length > 0) {
    const commResult = await callTool(
      phaseCtx('evaluate'),
      'groq.read_communication_state',
      `inputs=${rawTexts.length}`,
      () => tools.reasoning.readCommunicationState(rawTexts, state.communication),
    );
    if (commResult.ok) communication = commResult.data;
  }

  // --- Contradiction detection -------------------------------------------
  let contradictions: readonly Contradiction[] = state.confidence.contradictions;
  if (added.length > 0) {
    const contradictionResult = await callTool(
      phaseCtx('evaluate'),
      'groq.detect_contradiction',
      `newEvidence=${added.length}, priorEvidence=${state.evidence.length}`,
      () =>
        tools.reasoning.detectContradiction({
          state,
          newInputText: input.text ?? '',
          newEvidence: added,
        }),
    );
    if (contradictionResult.ok) {
      contradictions = mergeContradictions(contradictions, contradictionResult.data);
    }
  }
  contradictions = resolveContradictions(contradictions, evidence, added, now);

  // --- Confidence (deterministic, see confidence-policy.ts) ------------------
  const confidence = computeConfidence(
    {
      evidence,
      contradictions,
      communication,
      minEvidenceToScore: MIN_EVIDENCE_TO_SCORE,
      previous: state.confidence,
    },
    now,
  );

  for (const c of contradictions) {
    const wasKnown = state.confidence.contradictions.some(
      (existing) =>
        existing.kind === c.kind &&
        existing.conflictingEvidenceIds.join(',') === c.conflictingEvidenceIds.join(','),
    );
    if (!wasKnown) {
      timeline.push(
        mkEntry(tools.ids, c.detectedAt, {
          kind: 'confidence_alert_raised',
          provenance: 'agent_inference',
          summary: `Confidence alert — ${c.kind.replace(/_/g, ' ')}`,
          detail: c.detail,
          riskTierAfter: state.risk.tier,
          turnId,
        }),
      );
    } else if (c.resolvedAt === now) {
      timeline.push(
        mkEntry(tools.ids, now, {
          kind: 'confidence_alert_cleared',
          provenance: 'agent_inference',
          summary: `Contradiction resolved — ${c.kind.replace(/_/g, ' ')}`,
          ...(c.resolutionNote !== undefined ? { detail: c.resolutionNote } : {}),
          riskTierAfter: state.risk.tier,
          turnId,
        }),
      );
    }
  }

  // --- ACT: score if there is enough evidence to make it worthwhile -------
  let risk: RiskAssessment = state.risk;
  const activeCount = activeEvidence(evidence).length;
  if (added.length > 0 && readyToScore(activeCount)) {
    const scoreResult = await callTool(
      phaseCtx('act'),
      'infermedica.triage',
      `sex=${state.demographics.sex}, age=${state.demographics.ageYears}, evidence=${activeCount}`,
      () =>
        tools.risk.score({
          sex: state.demographics.sex,
          ageYears: state.demographics.ageYears,
          evidence: toInfermedicaEvidence(evidence),
        }),
    );
    if (scoreResult.ok) {
      const previousTier = risk.tier;
      risk = scoreResult.data;
      timeline.push(
        mkEntry(tools.ids, now, {
          kind: 'risk_scored',
          provenance: 'tool_output',
          summary: `Clinical scoring engine returned ${risk.triageLevel}`,
          detail: `${activeCount} active evidence items. Source: ${risk.source}.`,
          riskTierBefore: previousTier,
          riskTierAfter: risk.tier,
          turnId,
        }),
      );
      if (isEscalation(previousTier, risk.tier) || previousTier !== risk.tier) {
        timeline.push(
          mkEntry(tools.ids, now, {
            kind: 'risk_tier_changed',
            provenance: 'tool_output',
            summary: `Risk tier ${capitalize(previousTier)} → ${capitalize(risk.tier)}`,
            riskTierBefore: previousTier,
            riskTierAfter: risk.tier,
            turnId,
          }),
        );
      }
    }
  }

  // --- EVALUATE: may we finalise routing? Must we escalate? ------------------
  const gateCheck = canFinalizeRouting({ confidence, activeEvidenceCount: activeCount });
  const escalationCheck = mustEscalateUnresolved({
    tier: risk.tier,
    confidenceLevel: confidence.level,
    unresolvedContradictionCount: confidence.contradictions.filter((c) => c.resolvedAt === undefined).length,
    turnCount: state.turnCount + 1,
    patientResponsive: !(input.kind === 'system_tick' && state.relay.reason === 'patient_unresponsive'),
    clinicalScoringDegraded: risk.source === 'local_fallback',
  });

  let decidedAction: NextAction;
  let question: SelectedQuestion | undefined;
  let routing: RoutingDecision | undefined = state.routing;
  let status: CaseState['status'] = state.status;
  let escalation = state.escalation;

  if (escalationCheck.escalate) {
    decidedAction = 'escalate';
    status = 'escalated';
    const escalationDetail = escalationCheck.reason ?? 'Escalation criteria met.';
    escalation = {
      escalated: true,
      reason:
        confidence.level === 'low' && risk.tier === 'red'
          ? 'confidence_too_low_to_route'
          : risk.source === 'local_fallback'
            ? 'clinical_scoring_unavailable'
            : 'unresolved_contradiction_high_risk',
      detail: escalationDetail,
      at: now,
    };
    timeline.push(
      mkEntry(tools.ids, now, {
        kind: 'escalated_to_human',
        provenance: 'agent_inference',
        summary: 'Escalated to a human responder',
        detail: escalationDetail,
        riskTierAfter: risk.tier,
        turnId,
      }),
    );
  } else if (gateCheck.blocked) {
    decidedAction = gateCheck.requiredAction;
    // A contradiction (or a new evidence floor shortfall) reopens the case:
    // any earlier, still-unconfirmed proposal no longer reflects the current
    // evidence and must not linger as if it were still live. A decision the
    // user already confirmed (status 'action_taken') is untouched here —
    // that is `confirmRouting`'s domain, not a re-run of the interview loop.
    if (state.status !== 'action_taken' && state.status !== 'escalated') {
      status = 'interviewing';
      routing = undefined;
    }
    const questionResult = await callTool(
      phaseCtx('adapt'),
      'groq.select_next_question',
      `hardToDeflect=${gateCheck.reason === 'confidence_alert_active'}`,
      () =>
        tools.reasoning.selectNextQuestion({
          state: { ...state, risk, confidence, communication },
          candidateConceptIds: activeEvidence(evidence).map((e) => e.conceptId),
          requireHardToDeflect: gateCheck.reason === 'confidence_alert_active',
          language: state.language,
        }),
    );
    if (questionResult.ok) {
      question = questionResult.data;
      timeline.push(
        mkEntry(tools.ids, now, {
          kind: 'question_asked',
          provenance: 'agent_inference',
          summary: `Asked: ${question.text}`,
          detail: question.rationale,
          riskTierAfter: risk.tier,
          turnId,
        }),
      );
    }
  } else {
    decidedAction = 'propose_routing';
    const recommendation = recommendOutcome({
      assessment: risk,
      confidenceLevel: confidence.level,
      escalation: { escalate: false },
    });
    const gate = requiredGate(recommendation.outcome);
    const verification = verifyDecision({
      outcome: recommendation.outcome,
      gate,
      tier: risk.tier,
      confidenceLevel: confidence.level,
      unresolvedContradictionCount: 0,
    });

    if (verification.valid) {
      routing = {
        outcome: recommendation.outcome,
        rationale: `Based on ${risk.triageLevel} (${risk.source}) at ${confidence.level} confidence.`,
        policyRule: recommendation.policyRule,
        gate,
        proposedAt: now,
        basedOnRiskComputedAt: risk.computedAt,
      };
      status = 'awaiting_confirmation';
      timeline.push(
        mkEntry(tools.ids, now, {
          kind: 'routing_proposed',
          provenance: 'agent_inference',
          summary: `Proposed: ${recommendation.outcome.replace(/_/g, ' ')}`,
          detail: `Verified against policy. Allowed outcomes: ${allowedRoutingOutcomes(risk.tier, confidence.level).join(', ')}.`,
          riskTierAfter: risk.tier,
          turnId,
        }),
      );
    } else {
      // The verification gate tripped on our own recommendation. Refuse to
      // show it — escalate instead of presenting a decision that failed its
      // own check. This is the belt-and-braces case; it should not fire in
      // normal operation, but if it does, silence is the wrong response.
      decidedAction = 'escalate';
      status = 'escalated';
      escalation = {
        escalated: true,
        reason: 'repeated_tool_failure',
        detail: `Internal verification failed: ${verification.violations.join(' ')}`,
        at: now,
      };
      timeline.push(
        mkEntry(tools.ids, now, {
          kind: 'escalated_to_human',
          provenance: 'system_event',
          summary: 'Escalated — recommended routing failed its own verification',
          detail: verification.violations.join(' '),
          riskTierAfter: risk.tier,
          turnId,
        }),
      );
    }
  }

  // --- ADAPT: did the plan actually change, and why? --------------------
  const triggers: AdaptationTrigger[] = [];
  if (contradictions.some((c) => c.detectedAt === now)) triggers.push('contradiction_detected');
  if (risk.tier !== state.risk.tier) triggers.push('risk_tier_changed');
  if (added.some((e) => e.conceptType === 'symptom' && e.choiceId === 'present')) {
    triggers.push('new_symptom_reported');
  }
  if (!risk.degradedReason && state.risk.degradedReason) triggers.push('tool_unavailable');

  let adaptation: AdaptationRecord | undefined;
  if (triggers.length > 0 && priorPlannedAction !== decidedAction) {
    const trigger = triggers[0]!;
    adaptation = {
      trigger,
      plannedAction: priorPlannedAction,
      revisedAction: decidedAction,
      explanation: `${trigger.replace(/_/g, ' ')} changed the plan from "${priorPlannedAction}" to "${decidedAction}".`,
      at: now,
    };
    timeline.push(
      mkEntry(tools.ids, now, {
        kind: 'adaptation',
        provenance: 'agent_inference',
        summary: `Re-planned: ${adaptation.explanation}`,
        riskTierAfter: risk.tier,
        turnId,
      }),
    );
  }

  // --- Assemble ------------------------------------------------------------
  const turn: Turn = {
    id: turnId,
    index: state.turnCount,
    input,
    extractedEvidence: added,
    readout: { risk, confidence, communication },
    decidedAction,
    ...(question !== undefined ? { question } : {}),
    toolCallIds: toolCalls.map((c) => c.id),
    ...(adaptation !== undefined ? { adaptation } : {}),
    startedAt: now,
    completedAt: tools.clock.now(),
  };

  // Destructured out rather than spread-then-overridden: `routing` may need
  // to be CLEARED (not just left alone), and exactOptionalPropertyTypes
  // rejects assigning `routing: undefined` to an optional field directly —
  // omitting the key entirely is the only way to actually remove it.
  const { routing: _priorRouting, ...stateSansRouting } = state;
  const nextState: CaseState = {
    ...stateSansRouting,
    status,
    evidence,
    risk,
    confidence,
    communication,
    lastTurnId: turnId,
    turnCount: state.turnCount + 1,
    ...(routing !== undefined ? { routing } : {}),
    escalation,
    degradation: {
      clinicalScoringDegraded: risk.source === 'local_fallback',
      affectedTools: risk.source === 'local_fallback' ? ['infermedica.triage'] : [],
      ...(risk.degradedReason !== undefined ? { notice: risk.degradedReason, since: now } : {}),
    },
    updatedAt: now,
  };

  return { nextState: preserveActedOnOutcome(state, nextState), turn, timeline, toolCalls };
}

/**
 * Once a decision has been ACTED ON, later turns observe — they do not
 * re-decide.
 *
 * Found live: after a confirmed ambulance dispatch, adding an injury photo put
 * the case back into `awaiting_confirmation` while `dispatch.status` still read
 * `dispatch_requested`. The screen then asks the patient to hold the button to
 * request an ambulance that is already on its way — which either produces a
 * second request or, worse, reads as the first one having failed.
 *
 * The same guard already existed inside `runCompanionTick` for background
 * ticks. It belongs HERE, on the one function both paths go through, because
 * the hazard was never specific to ticks: any input arriving after the act is
 * enough.
 *
 * Note what is NOT frozen. `risk`, `confidence`, `evidence` and the timeline
 * all still update, so a deteriorating patient is visibly deteriorating and the
 * record stays complete. Only the already-taken OUTCOME is protected from
 * being silently rewound underneath the person looking at it.
 */
function preserveActedOnOutcome(before: CaseState, after: CaseState): CaseState {
  if (before.status !== 'action_taken' && before.status !== 'escalated') return after;
  return {
    ...after,
    status: before.status,
    escalation: before.escalation,
    ...(before.routing !== undefined ? { routing: before.routing } : {}),
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
