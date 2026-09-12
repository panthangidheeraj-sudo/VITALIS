/**
 * The timestamped case timeline (§4, §5.3, §5.4).
 *
 * Append-only. This is simultaneously the demo's Adaptation evidence and the
 * artefact a receiving clinician actually reads. It must be able to express the
 * spec's anchor trace verbatim:
 *
 *   7:00 — Chest pain starts
 *   7:02 — Pain spreads to left arm
 *   7:04 — Shortness of breath begins
 *   7:05 — Risk upgraded to Red
 *
 * Every entry carries `riskTierAfter`, so the risk trend graph is a projection
 * of the timeline rather than a second, separately-maintained history that
 * could drift out of sync with it.
 */

import type { IsoTimestamp, TimelineEntryId, ToolCallId, TurnId } from './common.js';
import type { RiskTier } from './risk.js';

export type TimelineEntryKind =
  /** Case opened with the initial complaint. */
  | 'case_opened'
  /** A symptom was first reported. */
  | 'symptom_reported'
  /** An existing symptom got worse or spread. */
  | 'symptom_progressed'
  /** A symptom resolved or was denied. */
  | 'symptom_resolved'
  /** A vital sign was recorded. */
  | 'vital_recorded'
  /** The agent asked something. */
  | 'question_asked'
  /** The patient or caregiver answered. */
  | 'answer_received'
  /** The deterministic scoring tool was called and returned. */
  | 'risk_scored'
  /** The tier moved. The escalation moment. */
  | 'risk_tier_changed'
  /** A Confidence Alert was raised (§5.1). */
  | 'confidence_alert_raised'
  | 'confidence_alert_cleared'
  /** The agent re-planned mid-flow. */
  | 'adaptation'
  /** A routing outcome was proposed, and later confirmed or cancelled. */
  | 'routing_proposed'
  | 'routing_confirmed'
  | 'routing_cancelled'
  /** Emergency contacts were notified. */
  | 'contacts_notified'
  /** A hospital was matched and the pre-arrival summary pushed. */
  | 'hospital_matched'
  | 'prearrival_summary_sent'
  /** Simulated dispatch lifecycle. */
  | 'dispatch_requested'
  | 'dispatch_updated'
  /** A Companion Mode reassessment ran (§5.4). */
  | 'companion_reassessment'
  /** Control handed to a caregiver (§5.5). */
  | 'relay_handoff'
  /** An external tool failed or degraded. Recorded, never hidden (§6). */
  | 'tool_degraded'
  /** Case handed to a human. */
  | 'escalated_to_human';

/**
 * §7 requires fact and inference to stay structurally separated — never blended
 * into one paragraph. Enforced here as a required field on every entry, so a
 * clinician reading the handoff can always tell what was *reported* from what
 * the agent *concluded*.
 */
export type EntryProvenance =
  /** Stated by the patient or caregiver, or measured. */
  | 'reported'
  /** Returned by an external clinical tool. */
  | 'tool_output'
  /** The agent's own inference from the above. */
  | 'agent_inference'
  /** A system/lifecycle event. */
  | 'system_event';

export interface TimelineEntry {
  readonly id: TimelineEntryId;
  readonly kind: TimelineEntryKind;
  readonly provenance: EntryProvenance;

  /** One line, clinician-readable. e.g. "Pain spreads to left arm". */
  readonly summary: string;
  /** Optional longer detail for the expanded view. */
  readonly detail?: string;
  /** The patient's own words, quoted verbatim when this entry came from them. */
  readonly quotedText?: string;

  /** Risk tier immediately after this entry. Lets the trend graph derive from the log. */
  readonly riskTierAfter?: RiskTier;
  /** Set on `risk_tier_changed` entries. */
  readonly riskTierBefore?: RiskTier;

  readonly turnId?: TurnId;
  /** Links an entry to the external call that produced it — the audit trail. */
  readonly toolCallId?: ToolCallId;

  /** When the event happened (may precede `recordedAt` for reported onset times). */
  readonly at: IsoTimestamp;
  /** When the system wrote it down. */
  readonly recordedAt: IsoTimestamp;
}

/** Entries a clinician should see highlighted on the handoff card. */
export const CLINICALLY_SIGNIFICANT_KINDS: ReadonlySet<TimelineEntryKind> = new Set([
  'symptom_reported',
  'symptom_progressed',
  'vital_recorded',
  'risk_tier_changed',
  'confidence_alert_raised',
  'escalated_to_human',
]);

export function clinicalHighlights(
  entries: readonly TimelineEntry[],
): readonly TimelineEntry[] {
  return entries.filter((e) => CLINICALLY_SIGNIFICANT_KINDS.has(e.kind));
}

/** Chronological by event time, with record time as a stable tiebreaker. */
export function sortChronologically(
  entries: readonly TimelineEntry[],
): readonly TimelineEntry[] {
  return [...entries].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
    return 0;
  });
}
