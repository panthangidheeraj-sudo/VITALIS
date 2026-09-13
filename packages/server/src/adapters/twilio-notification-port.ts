/**
 * Twilio - `NotificationPort`. The only adapter in this codebase that reaches a
 * real human being who did not ask to be contacted.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ONE HAS A KILL SWITCH AND THE OTHERS DO NOT
 *
 * Every other adapter reads. This one WRITES, to somebody's phone, and cannot
 * be undone. A wrong ICD-11 code is an embarrassment; a 3 a.m. "YOUR SON IS
 * HAVING A MEDICAL EMERGENCY" to a real number during a rehearsal is not
 * recoverable and is not funny. `TWILIO_LIVE=false` keeps the adapter fully
 * wired - same call sites, same timeline entries, same visible body text - and
 * simply does not put it on the wire, recording each message as `suppressed`
 * instead. Rehearse in that mode; switch it on for the real run.
 *
 * A dry run that SILENTLY did nothing would be the worst of both worlds, so
 * suppression is reported as a degraded result, not a success.
 * ---------------------------------------------------------------------------
 *
 * CHANNEL: WhatsApp is the default. India requires DLT template registration
 * for A2P SMS, and Twilio trial accounts can only message numbers verified in
 * the console - the WhatsApp sandbox has neither restriction. Note that the
 * sandbox also EXPIRES: a recipient must have sent the join code within the
 * last 72 hours or the message is accepted by the API and silently never
 * delivered. That failure is invisible from here, which is why the number the
 * demo uses should be re-joined the morning of the demo.
 */

import type {
  NotificationPort,
  OutboundMessage,
  ToolResult,
} from '@triage/shared';
import { failedResult, fallbackResult, liveResult } from '@triage/shared';
import { requestJson } from './http.js';

export interface TwilioConfig {
  readonly accountSid: string;
  readonly authToken: string;
  /** `whatsapp:+14155238886` for the sandbox. */
  readonly whatsappFrom?: string;
  /** E.164. Only reaches verified numbers on a trial account. */
  readonly smsFrom?: string;
  /** False keeps every call site intact but puts nothing on the wire. */
  readonly live: boolean;
}

interface TwilioMessageResponse {
  readonly sid?: string;
  readonly status?: string;
  readonly error_message?: string;
}

/**
 * Notifications are on the critical path of an emergency but are not on the
 * critical path of the DECISION - the ambulance is already requested by the
 * time these go out. Worth a little patience, not much.
 */
const NOTIFY_POLICY = {
  maxAttempts: 2,
  baseDelayMs: 400,
  maxDelayMs: 1500,
  timeoutMs: 10_000,
} as const;

export class TwilioNotificationPort implements NotificationPort {
  constructor(private readonly config: TwilioConfig) {}

  async send(message: OutboundMessage): Promise<ToolResult<{ readonly providerMessageId: string }>> {
    const from = this.from(message.channel);
    if (from === undefined) {
      return failedResult(
        {
          kind: 'bad_request',
          message: `No Twilio sender configured for channel ${message.channel}.`,
          retryable: false,
        },
        0,
        this.degradation(message, 'no sender number is configured for that channel'),
      );
    }

    if (!this.config.live) {
      // Deliberately a FALLBACK result, not a live one. The caller records a
      // notification the recipient never saw, and it must be labelled that way
      // on the timeline - otherwise a rehearsal produces a case record that is
      // indistinguishable from one where the family really was told.
      return fallbackResult(
        { providerMessageId: `dry-run-${Date.now()}` },
        0,
        this.degradation(message, 'TWILIO_LIVE=false - the message was composed but not sent'),
      );
    }

    const to = message.channel === 'whatsapp' ? `whatsapp:${message.toE164}` : message.toE164;
    const body = new URLSearchParams({ To: to, From: from, Body: message.body });

    const outcome = await requestJson<TwilioMessageResponse>(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // Basic auth, base64 of sid:token. The token never leaves this
          // process - the phone has no Twilio credential at all (spec 3.1).
          authorization: `Basic ${Buffer.from(
            `${this.config.accountSid}:${this.config.authToken}`,
          ).toString('base64')}`,
        },
        body: body.toString(),
        policy: NOTIFY_POLICY,
      },
    );

    if (!outcome.ok || outcome.value?.sid === undefined) {
      return failedResult(
        outcome.error ?? {
          kind: 'invalid_response',
          message: outcome.value?.error_message ?? 'Twilio returned no message sid.',
          retryable: true,
        },
        outcome.latencyMs,
        this.degradation(message, 'the provider rejected or dropped the message'),
      );
    }

    return liveResult({ providerMessageId: outcome.value.sid }, outcome.latencyMs);
  }

  private from(channel: OutboundMessage['channel']): string | undefined {
    if (channel === 'whatsapp') return this.config.whatsappFrom;
    if (channel === 'sms') return this.config.smsFrom;
    // fcm_push is a different transport entirely and is not implemented; saying
    // so beats quietly sending an SMS the user did not choose.
    return undefined;
  }

  /**
   * The user-facing sentence deliberately tells the PATIENT that their contact
   * was not reached. A failed notification that only appears in a server log is
   * the difference between someone calling their mother themselves and someone
   * assuming it was handled.
   */
  private degradation(message: OutboundMessage, why: string) {
    return {
      tool: 'twilio.send_message',
      reason: 'unavailable' as const,
      userFacingMessage: `I could not reach your emergency contact on ${message.channel} - ${why}. Call them directly if you can.`,
      fallbackUsed: 'the message is recorded on the case timeline as not delivered',
      conservative: true,
    };
  }
}
