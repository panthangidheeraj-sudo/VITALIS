/**
 * Emergency-contact notification (spec 3, 5.5).
 *
 * WHY THIS LIVES IN packages/server AND NOT IN THE LOOP: `confirmRouting` says
 * so in a comment, and the reason holds. The contact list belongs to the
 * PATIENT PROFILE, not to the case snapshot the loop receives. Wiring a guessed
 * contact list into the agent would have meant either inventing numbers or
 * threading a profile store through every loop function for one side effect.
 *
 * WHERE THE CONTACTS COME FROM, STATED PLAINLY: the device sends them with the
 * confirmation, because the medical profile is still device-local demo data by
 * the user's explicit instruction. That means a crafted request could name any
 * phone number and have this server text it. The threat model here is the same
 * one 5.2 names for the press-and-hold gate - accidental triggering, not a
 * determined attacker - and this is a hackathon build behind no public DNS.
 * The fix when the profile is persisted is one line: read contacts from
 * `patients/{ownerUid}` and ignore whatever the request body claims. That is
 * the intended next step, not an afterthought.
 *
 * ORDERING: contacts are tried in `priority` order and ALL of them are
 * notified, not just the first. An emergency contact who is in a meeting is not
 * a delivered message, and there is no read receipt to fall back on.
 */

import type {
  AgentTools,
  CaseState,
  GeoPoint,
  NotificationChannel,
  NotificationKind,
  NotificationRecord,
  TimelineEntry,
  ToolCallRecord,
} from '@triage/shared';
import { asTimelineEntryId, asTurnId } from '@triage/shared';
import { callTool, type CallToolContext } from '@triage/agent';

/** The subset of `EmergencyContact` a notification actually needs. */
export interface NotifiableContact {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly phoneE164: string;
  readonly whatsappEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly priority: number;
  readonly canRelay: boolean;
}

export interface NotifyResult {
  readonly records: readonly NotificationRecord[];
  readonly timeline: readonly TimelineEntry[];
  readonly toolCalls: readonly ToolCallRecord[];
}

/**
 * Picks the channel for one contact.
 *
 * WhatsApp first because it is the only channel that reliably reaches an
 * unverified Indian number from a Twilio trial account (see the adapter
 * header). A contact who has opted out of both is skipped rather than messaged
 * on a channel they declined.
 */
function channelFor(contact: NotifiableContact): NotificationChannel | undefined {
  if (contact.whatsappEnabled) return 'whatsapp';
  if (contact.smsEnabled) return 'sms';
  return undefined;
}

/**
 * Composes the message body.
 *
 * Written as a TEMPLATE, not by the language model, and that is deliberate.
 * This text crosses a system boundary to a person who cannot ask a follow-up
 * question, and every sentence in it has to be literally true regardless of
 * what the model would have phrased. It states the risk tier, the outcome, and
 * where the patient is - nothing interpretive, no reassurance, no diagnosis.
 *
 * Location is included ONLY when the caller passes it, which happens only after
 * the patient confirmed the routing decision. A location share that the patient
 * did not trigger is a tracking feature, not a safety one.
 */
export function composeBody(input: {
  readonly kind: NotificationKind;
  readonly patientName: string;
  readonly state: CaseState;
  readonly location?: GeoPoint;
}): string {
  const { kind, patientName, state, location } = input;
  const where =
    location === undefined
      ? ''
      : ` Location: https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=17/${location.lat}/${location.lng}`;

  switch (kind) {
    case 'emergency_alert': {
      const outcome = state.routing?.outcome.replace(/_/g, ' ') ?? 'emergency assessment';
      return (
        `VITALIS emergency alert. ${patientName} has an active ${state.risk.tier.toUpperCase()} assessment ` +
        `and the recommended action is: ${outcome}.` +
        `${where} This was sent automatically after ${patientName} confirmed it. Reply or call them now.`
      );
    }
    case 'relay_request':
      return (
        `VITALIS: ${patientName} has stopped responding during an emergency assessment ` +
        `(current level: ${state.risk.tier.toUpperCase()}). You are listed as someone who can answer on their behalf. ` +
        `Open VITALIS and enter case ${state.caseId} to take over.${where}`
      );
    case 'cancellation':
      return `VITALIS: ${patientName} has cancelled their emergency alert. No further action is needed.`;
    case 'location_share':
      return `VITALIS: ${patientName} shared their location with you.${where}`;
    case 'status_update':
      return `VITALIS update on ${patientName}: assessment level is now ${state.risk.tier.toUpperCase()}.`;
    case 'resolution':
      return `VITALIS: ${patientName}'s case has been closed.`;
  }
}

export async function notifyContacts(
  state: CaseState,
  contacts: readonly NotifiableContact[],
  tools: AgentTools,
  options: {
    readonly kind: NotificationKind;
    readonly patientName: string;
    /** Shared only when the patient's confirmation covered it. */
    readonly location?: GeoPoint;
    /** Restrict to contacts allowed to take over the interview (5.5). */
    readonly relayCapableOnly?: boolean;
  },
): Promise<NotifyResult> {
  const now = tools.clock.now();
  const records: NotificationRecord[] = [];
  const timeline: TimelineEntry[] = [];
  const toolCalls: ToolCallRecord[] = [];

  const ctx: CallToolContext = {
    clock: tools.clock,
    ids: tools.ids,
    turnId: state.lastTurnId ?? asTurnId(tools.ids.newId('turn')),
    phase: 'act',
    toolCalls,
    timeline,
  };

  const targets = [...contacts]
    .filter((c) => options.relayCapableOnly !== true || c.canRelay)
    .sort((a, b) => a.priority - b.priority);

  const body = composeBody({
    kind: options.kind,
    patientName: options.patientName,
    state,
    ...(options.location !== undefined ? { location: options.location } : {}),
  });

  for (const contact of targets) {
    const channel = channelFor(contact);
    if (channel === undefined) {
      // Recorded, not skipped silently. "We never told your father" and "your
      // father had opted out of both channels" are different facts and the
      // timeline has to be able to tell them apart.
      records.push({
        contactId: contact.id as NotificationRecord['contactId'],
        channel: 'sms',
        kind: options.kind,
        status: 'suppressed',
        body,
        failureReason: 'Contact has neither WhatsApp nor SMS enabled.',
        queuedAt: now,
      });
      continue;
    }

    const result = await callTool(ctx, 'twilio.send_message', `${channel}->${contact.name}`, () =>
      tools.notifications.send({
        contactId: contact.id as NotificationRecord['contactId'],
        toE164: contact.phoneE164,
        channel,
        kind: options.kind,
        body,
        ...(options.location !== undefined ? { location: options.location } : {}),
      }),
    );

    records.push({
      contactId: contact.id as NotificationRecord['contactId'],
      channel,
      kind: options.kind,
      // A dry run and a real send both come back `ok`; only `source: 'live'`
      // means it actually left the building. See the adapter header.
      status: result.ok ? (result.source === 'live' ? 'sent' : 'suppressed') : 'failed',
      body,
      ...(options.location !== undefined ? { sharedLocation: options.location } : {}),
      ...(result.ok && result.source === 'live'
        ? { providerMessageId: result.data.providerMessageId, sentAt: tools.clock.now() }
        : {}),
      ...(!result.ok ? { failureReason: result.error.message } : {}),
      ...(result.ok && result.source !== 'live'
        ? { failureReason: result.degraded.fallbackUsed }
        : {}),
      queuedAt: now,
    });
  }

  const delivered = records.filter((r) => r.status === 'sent').length;
  timeline.push({
    id: asTimelineEntryId(tools.ids.newId('tl')),
    kind: 'contacts_notified',
    provenance: 'system_event',
    summary:
      targets.length === 0
        ? 'No emergency contact was available to notify'
        : `${delivered}/${targets.length} emergency contacts notified`,
    riskTierAfter: state.risk.tier,
    at: now,
    recordedAt: now,
  });

  return { records, timeline, toolCalls };
}
