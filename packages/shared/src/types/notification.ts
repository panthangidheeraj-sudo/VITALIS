/**
 * Emergency-contact notifications (§3, §5.5).
 *
 * DELIVERY CONSTRAINT, flagged: India A2P SMS requires DLT template
 * registration, and Twilio trial accounts only reach verified numbers. The
 * WhatsApp sandbox has neither restriction, so it is the default demo channel.
 * SMS stays available behind the same port for verified numbers.
 */

import type { ContactId, GeoPoint, IsoTimestamp } from './common.js';

export type NotificationChannel = 'whatsapp' | 'sms' | 'fcm_push';

export type NotificationKind =
  /** Risk reached Red, or an ambulance was dispatched. */
  | 'emergency_alert'
  /** Periodic status while the case is live. */
  | 'status_update'
  /** Live location share (§5.5). */
  | 'location_share'
  /** Invitation for a contact to take over the interview (§5.5). */
  | 'relay_request'
  /** The alert was cancelled. */
  | 'cancellation'
  /** Case resolved / closed. */
  | 'resolution';

export type NotificationStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  /** Blocked by a safety gate that was never satisfied. */
  | 'suppressed';

export interface NotificationRecord {
  readonly contactId: ContactId;
  readonly channel: NotificationChannel;
  readonly kind: NotificationKind;
  readonly status: NotificationStatus;
  /** Exact body sent. Retained so the timeline can show what a contact actually saw. */
  readonly body: string;
  /** Included only for `location_share`, and only after explicit confirmation. */
  readonly sharedLocation?: GeoPoint;
  /** Provider message id, for delivery-status reconciliation. */
  readonly providerMessageId?: string;
  readonly failureReason?: string;
  readonly queuedAt: IsoTimestamp;
  readonly sentAt?: IsoTimestamp;
  readonly deliveredAt?: IsoTimestamp;
}

/**
 * Family Relay Mode state (§5.5). When the patient stops responding, control
 * passes to a caregiver who answers on their behalf — and the communication
 * state flips to `caregiver_relay`, shifting tone toward clinical precision.
 */
export interface RelayState {
  readonly active: boolean;
  readonly relayContactId?: ContactId;
  readonly requestedAt?: IsoTimestamp;
  readonly acceptedAt?: IsoTimestamp;
  /**
   * Why the handoff happened. `patient_unresponsive` is the trigger the spec
   * names; `patient_requested` and `minor_needs_adult` cover the other paths.
   */
  readonly reason?: 'patient_unresponsive' | 'patient_requested' | 'minor_needs_adult';
  /** How long the patient was silent before handoff, for the timeline. */
  readonly silenceSeconds?: number;
}
