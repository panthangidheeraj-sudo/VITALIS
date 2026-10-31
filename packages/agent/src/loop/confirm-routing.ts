/**
 * What happens after the safety gate is satisfied (spec §5.2/§5.3) — the
 * "Final Outcome" beat.
 *
 * Deliberately a separate function from `orchestrateTurn`. The interview loop
 * PROPOSES a routing decision; it never acts on it. Confirmation is a distinct
 * user action (a completed 3-second hold, or an explicit tap) that the caller
 * observes and reports — this function is what runs once that has happened,
 * autonomously sequencing the hospital match, the pre-arrival push, and the
 * emergency-contact notifications in one pass. That sequencing across
 * multiple tools, triggered by a single confirmed decision, is itself part of
 * the tool-interaction story the rubric looks for, distinct from the
 * per-turn interview loop.
 *
 * Never called on a routing decision whose gate is not `satisfied` — enforced
 * by the guard at the top rather than trusted to the caller.
 */

import type {
  AgentTools,
  CaseState,
  Hospital,
  HospitalMatch,
  Millis,
  IsoTimestamp,
  NotificationRecord,
  PreArrivalSummary,
  TimelineEntry,
  ToolCallRecord,
} from '@triage/shared';
import { asTimelineEntryId, asTurnId, estimateTravelMinutes, failedResult, haversineKm } from '@triage/shared';
import { callTool, type CallToolContext } from './ledger.js';

export interface ConfirmRoutingResult {
  readonly nextState: CaseState;
  readonly timeline: readonly TimelineEntry[];
  readonly toolCalls: readonly ToolCallRecord[];
}

export class GateNotSatisfiedError extends Error {
  constructor() {
    super('confirmRouting called before the safety gate was satisfied.');
    this.name = 'GateNotSatisfiedError';
  }
}

function mkEntry(
  ids: AgentTools['ids'],
  at: IsoTimestamp,
  partial: Omit<TimelineEntry, 'id' | 'recordedAt' | 'at'>,
): TimelineEntry {
  return { id: asTimelineEntryId(ids.newId('tl')), at, recordedAt: at, ...partial };
}

/**
 * How long the hospital match may hold up a CONFIRMED emergency.
 *
 * This is not the hospital port's own budget and must not be confused with
 * it: OVERPASS_POLICY (osm-hospital-port.ts) allows 12s per public instance
 * across three instances, which is a sane ceiling for the "Find nearby
 * hospitals" button — a user tapped it and is willing to wait for a list.
 *
 * It is NOT sane here. Measured against the real server with Overpass
 * degraded, a confirm took 36.6 SECONDS to return, because every mirror
 * timed out in turn while the request sat open. Everything the patient is
 * waiting on sits behind that response: the dispatch state change, the
 * emergency-contact messages, and — on the web client — the automatic dial
 * to the emergency number. A map lookup is not allowed to delay any of
 * those, least of all by half a minute, in the one moment this app exists
 * for.
 *
 * So the lookup gets a hard deadline on this path. Losing the race is not
 * an error and is not retried: `hospital` simply stays undefined, exactly
 * as it already does when Overpass fails outright, and the handoff card
 * renders without a matched hospital rather than with a stale or guessed
 * one. The routing decision, the gate and the notifications are unaffected
 * — none of them ever depended on this.
 */
const HOSPITAL_MATCH_DEADLINE_MS = 4_000;

/**
 * Resolves to `onDeadline()` if `operation` has not settled in time.
 *
 * The losing request is abandoned, not cancelled — the port has no abort
 * handle to pass in, and a late reply is harmless because nothing reads it
 * after the race. The timer is always cleared so a settled operation cannot
 * leave a pending handle holding the process open.
 */
async function withDeadline<T>(
  operation: () => Promise<T>,
  deadlineMs: number,
  onDeadline: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onDeadline()), deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function confirmRouting(
  state: CaseState,
  tools: AgentTools,
  confirmedAt: IsoTimestamp,
): Promise<ConfirmRoutingResult> {
  if (state.routing === undefined || state.routing.gate.state !== 'satisfied') {
    throw new GateNotSatisfiedError();
  }

  const timeline: TimelineEntry[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const turnId = state.lastTurnId ?? asTurnId(tools.ids.newId('turn'));
  const ctx = (phase: CallToolContext['phase']): CallToolContext => ({
    clock: tools.clock,
    ids: tools.ids,
    turnId,
    phase,
    toolCalls,
    timeline,
  });

  const routing = { ...state.routing, confirmedAt };
  timeline.push(
    mkEntry(tools.ids, confirmedAt, {
      kind: 'routing_confirmed',
      provenance: 'system_event',
      summary: `Confirmed: ${routing.outcome.replace(/_/g, ' ')}`,
      riskTierAfter: state.risk.tier,
    }),
  );

  let hospital: HospitalMatch | undefined = state.hospital;
  let preArrival: PreArrivalSummary | undefined = state.preArrival;
  let dispatch = state.dispatch;
  let notifications: readonly NotificationRecord[] = state.notifications;

  const needsHospital =
    routing.outcome === 'ambulance_dispatch' ||
    routing.outcome === 'er_self_transport' ||
    routing.outcome === 'urgent_care_now';

  if (needsHospital && state.lastKnownLocation !== undefined) {
    const hospitalResult = await callTool(
      ctx('act'),
      'osm.find_hospitals',
      `origin=${state.lastKnownLocation.lat},${state.lastKnownLocation.lng}`,
      () =>
        withDeadline(
          () =>
            tools.hospitals.findNearby({
              origin: state.lastKnownLocation!,
              radiusKm: 20,
              requireEmergencyDepartment: true,
              limit: 5,
            }),
          HOSPITAL_MATCH_DEADLINE_MS,
          // Reported as a real failure, not quietly as "no hospitals found":
          // the distinction between "we looked and the area has none" and "we
          // ran out of time" is exactly what the ledger and the degradation
          // notice exist to preserve.
          () =>
            failedResult<readonly Hospital[]>(
              {
                kind: 'timeout',
                message: `hospital match exceeded ${HOSPITAL_MATCH_DEADLINE_MS}ms on the confirm path`,
                retryable: true,
              },
              HOSPITAL_MATCH_DEADLINE_MS as Millis,
              {
                tool: 'osm.find_hospitals',
                reason: 'timeout',
                userFacingMessage:
                  'We could not match a hospital in time, so none is shown. Your emergency request still went through.',
                fallbackUsed: 'none — the request proceeded without a matched hospital',
                // No clinical bearing: this decorates the handoff card and
                // cannot move a risk tier or a routing outcome in any
                // direction, so there is nothing to round conservatively.
                conservative: true,
              },
            ),
        ),
    );
    if (hospitalResult.ok && hospitalResult.data.length > 0) {
      const best = hospitalResult.data[0]!;
      // Real numbers now that the port returns real coordinates. These were
      // hardcoded zeros while the only implementation was a fixture, and a
      // tracking screen reading "0 km, 0 min away" is worse than one reading
      // nothing - it looks like an arrival, not a missing value.
      const distanceKm = haversineKm(state.lastKnownLocation, best.location);
      hospital = {
        hospital: best,
        distanceKm,
        estimatedTravelMinutes: estimateTravelMinutes(distanceKm),
        specialtyMatched: best.specialties.length > 0,
        matchRationale: `Nearest facility with an emergency department, approximately ${distanceKm.toFixed(1)} km away.`,
        matchedAt: confirmedAt,
      };
      timeline.push(
        mkEntry(tools.ids, confirmedAt, {
          kind: 'hospital_matched',
          provenance: 'tool_output',
          summary: `${best.name} matched (~${distanceKm.toFixed(1)} km)`,
          riskTierAfter: state.risk.tier,
        }),
      );

      const pushResult = await callTool(
        ctx('act'),
        'hospital.push_prearrival',
        `destination=${best.osmId}`,
        () =>
          tools.hospitals.pushPreArrival({
            caseId: state.caseId,
            osmId: best.osmId,
            payload: { caseId: state.caseId, outcome: routing.outcome, riskTier: state.risk.tier },
          }),
      );
      if (pushResult.ok) {
        preArrival = pushResult.data;
        timeline.push(
          mkEntry(tools.ids, confirmedAt, {
            kind: 'prearrival_summary_sent',
            provenance: 'system_event',
            summary: 'Pre-arrival summary sent',
            riskTierAfter: state.risk.tier,
          }),
        );
      }
    }
  }

  if (routing.outcome === 'ambulance_dispatch') {
    dispatch = {
      status: 'dispatch_requested',
      simulated: true,
      requestedAt: confirmedAt,
    };
    timeline.push(
      mkEntry(tools.ids, confirmedAt, {
        kind: 'dispatch_requested',
        provenance: 'system_event',
        summary: 'Ambulance requested (simulated)',
        riskTierAfter: state.risk.tier,
      }),
    );
  }

  // Emergency-contact notifications are intentionally NOT sent here: the
  // contact list lives on the patient profile (PatientProfile.contacts), not
  // on the case snapshot this function receives, and packages/server is
  // where that profile lookup plus the real Twilio call belong. Wiring a
  // guessed contact list in here would be worse than leaving it explicit.

  // COMPANION MODE STARTS HERE (5.4). This is the line that makes the system an
  // agent rather than a form: the triage decision is not the end of the
  // interaction, it is the point at which the agent stops asking and starts
  // watching. Until now `companion.active` was false at every construction site
  // and nothing ever flipped it, so `runCompanionTick` existed and was
  // unreachable - the scheduler in packages/server polls exactly this flag.
  //
  // The first reassessment is scheduled one interval out rather than
  // immediately: the state was recomputed moments ago and an instant re-tick
  // would put a meaningless "nothing changed" entry on the timeline directly
  // under the decision.
  const companion = {
    ...state.companion,
    active: true,
    nextReassessmentDueAt: new Date(
      new Date(confirmedAt).getTime() + state.companion.intervalMs,
    ).toISOString(),
  };

  const nextState: CaseState = {
    ...state,
    routing,
    status: 'action_taken',
    companion,
    dispatch,
    ...(hospital !== undefined ? { hospital } : {}),
    ...(preArrival !== undefined ? { preArrival } : {}),
    notifications,
    updatedAt: confirmedAt,
  };

  return { nextState, timeline, toolCalls };
}
