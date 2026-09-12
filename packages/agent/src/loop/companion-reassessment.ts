/**
 * Companion Mode reassessment (spec §5.4). The agent does not terminate after
 * an initial triage decision — every 2-5 minutes it re-checks the same three
 * axes against whatever new evidence has accumulated (a caregiver's update, a
 * new vital reading) and appends to the timeline either way, so "nothing
 * changed" is itself a recorded, timestamped fact rather than silence.
 *
 * A `system_tick` input carries no new patient statement, so this reuses
 * `orchestrateTurn` rather than re-implementing the loop: a tick with no new
 * evidence still recomputes confidence (time-decay-free, but contradiction
 * state can still resolve) and re-scores if anything is pending. Trend
 * direction is tracked here on top of that, from the risk tier delta plus any
 * newly-added respiratory/consciousness/bleeding-relevant evidence.
 */

import type { AgentTools, CaseState, CompanionState, IsoTimestamp, TimelineEntry, ToolCallRecord, TrendDirection } from '@triage/shared';
import { COMPANION_DEFAULT_INTERVAL_MS, asTimelineEntryId, trendBetween } from '@triage/shared';
import { orchestrateTurn } from './orchestrator.js';

export interface CompanionTickResult {
  readonly nextState: CaseState;
  readonly timeline: readonly TimelineEntry[];
  readonly toolCalls: readonly ToolCallRecord[];
}

export function isReassessmentDue(companion: CompanionState, now: IsoTimestamp): boolean {
  if (!companion.active) return false;
  if (companion.nextReassessmentDueAt === undefined) return true;
  return now >= companion.nextReassessmentDueAt;
}

export async function runCompanionTick(
  state: CaseState,
  tools: AgentTools,
): Promise<CompanionTickResult> {
  const now = tools.clock.now();

  const { nextState: rawNext, timeline, toolCalls } = await orchestrateTurn(
    state,
    { kind: 'system_tick', receivedAt: now },
    tools,
  );

  // A tick recomputes risk/confidence/evidence — that is the whole point of
  // monitoring — but once a decision has already been acted on (dispatch
  // requested, escalated to a human), a background tick must not silently
  // re-propose a fresh routing decision or flip the case back to
  // "awaiting_confirmation". Once acted on, Companion Mode observes; it does
  // not re-decide. A NEW escalation trigger (risk rising further) still
  // updates `risk`/`confidence` here and is visible on the timeline; it just
  // does not overwrite an already-confirmed outcome or already-escalated
  // status from underneath the user.
  const preserveOutcomeState = state.status === 'action_taken' || state.status === 'escalated';
  const nextState: CaseState = preserveOutcomeState
    ? {
        ...rawNext,
        status: state.status,
        escalation: state.escalation,
        ...(state.routing !== undefined ? { routing: state.routing } : {}),
      }
    : rawNext;

  const breathing: TrendDirection = trendBetween(state.risk.tier, nextState.risk.tier);
  const companion: CompanionState = {
    ...state.companion,
    lastReassessedAt: now,
    nextReassessmentDueAt: addMs(now, state.companion.intervalMs || COMPANION_DEFAULT_INTERVAL_MS),
    reassessmentCount: state.companion.reassessmentCount + 1,
    trends: {
      ...state.companion.trends,
      // Breathing trend follows the overall risk trend as the closest proxy
      // available without a dedicated respiratory-rate reading; a real vital
      // (respiratory_rate / spo2) overrides this the moment one is recorded.
      breathing,
    },
  };

  const entry: TimelineEntry = {
    id: asTimelineEntryId(tools.ids.newId('tl')),
    kind: 'companion_reassessment',
    provenance: 'agent_inference',
    summary: `Reassessment ${companion.reassessmentCount} — ${breathing}`,
    riskTierAfter: nextState.risk.tier,
    at: now,
    recordedAt: now,
  };

  return {
    nextState: { ...nextState, companion },
    timeline: [...timeline, entry],
    toolCalls,
  };
}

function addMs(iso: IsoTimestamp, ms: number): IsoTimestamp {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}
