/**
 * Family Relay Mode (spec 5.5) - control of a live case passing from the
 * patient to a caregiver.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS TWO ENDPOINTS AND NOT ONE
 *
 * Requesting a relay and being in a relay are different facts, and collapsing
 * them would mean the case claims a caregiver is answering from the moment the
 * message is sent - before anyone has read it, and possibly forever if nobody
 * does. `relay.active` therefore flips only on ACCEPT, from the caregiver's own
 * device. Until then the case records `requestedAt` and keeps the patient in
 * control, which is also the state the escalation policy needs to be able to
 * see: "we asked for help and nobody came" is a reason to escalate to a human,
 * and it is invisible if the request alone marked the relay active.
 * ---------------------------------------------------------------------------
 *
 * THE TONE SHIFT IS THE POINT, per 5.5. Accepting a relay sets the
 * communication state to `caregiver_relay`, which moves the agent's phrasing
 * toward clinical precision - a caregiver can be asked "is the breathing
 * laboured or shallow?" in a way a frightened patient cannot. That is a real
 * adaptation to a changed interlocutor, not a cosmetic flag, and it is why the
 * state lives on the case rather than in the caller's session.
 *
 * ACCESS: accepting adds the caregiver's uid to `relayUids`, which is what
 * firebase/firestore.rules matches on for read access. Before that write the
 * caregiver's device can see nothing at all - the live listener simply returns
 * empty - so this endpoint is the one thing standing between them and a blank
 * screen, and it must run before they are told to open the case.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AgentTools, CaseId, CaseState, Uid } from '@triage/shared';
import { asCaseId, asContactId, asTimelineEntryId, asUid } from '@triage/shared';
import { notifyContacts, type NotifiableContact } from '../notify/notify-contacts.js';

const contactSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  relationship: z.string().max(40).default('other'),
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164, e.g. +919876543210'),
  whatsappEnabled: z.boolean().default(true),
  smsEnabled: z.boolean().default(false),
  priority: z.number().int().min(0).max(99).default(0),
  canRelay: z.boolean().default(false),
});

const requestSchema = z.object({
  patientName: z.string().min(1).max(120),
  /**
   * Sent by the device because the medical profile is still device-local. See
   * the header of notify-contacts.ts for what that does and does not assume.
   */
  contacts: z.array(contactSchema).min(1).max(10),
  reason: z
    .enum(['patient_unresponsive', 'patient_requested', 'minor_needs_adult'])
    .default('patient_unresponsive'),
  /** How long the patient was silent, for the timeline. */
  silenceSeconds: z.number().int().min(0).max(86_400).optional(),
  /** Included only when the patient had already consented to sharing it. */
  shareLocation: z.boolean().default(false),
});

const acceptSchema = z.object({
  /** The CAREGIVER's Firebase uid - not the patient's. */
  relayUid: z.string().min(1).max(128),
  contactId: z.string().min(1).max(64).optional(),
});

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void): void => {
    handler(req, res).catch(next);
  };
}

export function createRelayRoutes(tools: AgentTools): Router {
  const router = Router({ mergeParams: true });

  const load = async (req: Request, res: Response): Promise<CaseState | undefined> => {
    const caseId: CaseId = asCaseId(req.params['id'] as string);
    const state = await tools.store.get(caseId);
    if (state === undefined) {
      res.status(404).json({ error: 'case_not_found' });
      return undefined;
    }
    return state;
  };

  // --- Ask a caregiver to take over ---------------------------------------
  router.post(
    '/request',
    wrap(async (req, res) => {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }
      const state = await load(req, res);
      if (state === undefined) return;

      const relayCapable = parsed.data.contacts.filter((c) => c.canRelay);
      if (relayCapable.length === 0) {
        // A distinct 409, not an empty success. "Nobody on your list can take
        // over" is something the patient's screen has to be able to say, and it
        // is a legitimate trigger for escalating to a human instead.
        res.status(409).json({
          error: 'no_relay_capable_contact',
          message: 'No emergency contact on this profile is marked as able to relay.',
        });
        return;
      }

      const now = tools.clock.now();
      const result = await notifyContacts(
        state,
        relayCapable as readonly NotifiableContact[],
        tools,
        {
          kind: 'relay_request',
          patientName: parsed.data.patientName,
          relayCapableOnly: true,
          ...(parsed.data.shareLocation && state.lastKnownLocation !== undefined
            ? { location: state.lastKnownLocation }
            : {}),
        },
      );

      const next: CaseState = {
        ...state,
        revision: state.revision + 1,
        relay: {
          // NOT active yet. See the header.
          active: false,
          relayContactId: asContactId(relayCapable[0]!.id),
          requestedAt: now,
          reason: parsed.data.reason,
          ...(parsed.data.silenceSeconds !== undefined
            ? { silenceSeconds: parsed.data.silenceSeconds }
            : {}),
        },
        notifications: [...state.notifications, ...result.records],
        updatedAt: now,
      };

      await tools.store.update(state.caseId, state.revision, next);
      await tools.store.appendTimeline(state.caseId, [
        ...result.timeline,
        {
          id: asTimelineEntryId(tools.ids.newId('tl')),
          kind: 'relay_handoff',
          provenance: 'system_event',
          summary: `Relay requested — ${parsed.data.reason.replace(/_/g, ' ')}`,
          detail: `Asked ${relayCapable.map((c) => c.name).join(', ')} to take over.`,
          riskTierAfter: state.risk.tier,
          at: now,
          recordedAt: now,
        },
      ]);
      for (const call of result.toolCalls) await tools.store.appendToolCall(state.caseId, call);

      res.json({
        relay: next.relay,
        invited: relayCapable.map((c) => c.name),
        notifications: result.records.map((r) => ({ contactId: r.contactId, status: r.status })),
      });
    }),
  );

  // --- The caregiver takes over -------------------------------------------
  router.post(
    '/accept',
    wrap(async (req, res) => {
      const parsed = acceptSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }
      const state = await load(req, res);
      if (state === undefined) return;

      if (state.relay.requestedAt === undefined) {
        // Nobody may insert themselves into a case that did not ask for help.
        // Weak as authorisation goes — it is a hackathon and there is no token
        // check here — but it does mean relay access follows an action the
        // patient's own device took, rather than being available to anyone who
        // learns a case id.
        res.status(409).json({
          error: 'relay_not_requested',
          message: 'This case has not asked for a caregiver to take over.',
        });
        return;
      }

      const now = tools.clock.now();
      const uid: Uid = asUid(parsed.data.relayUid);
      const existing = state.relayUids ?? [];

      const next: CaseState = {
        ...state,
        revision: state.revision + 1,
        mode: 'family_relay',
        // Idempotent: a caregiver tapping Accept twice must not duplicate the
        // uid, because the rules array is read on every single document read.
        relayUids: existing.includes(uid) ? existing : [...existing, uid],
        relay: {
          ...state.relay,
          active: true,
          acceptedAt: now,
          ...(parsed.data.contactId !== undefined
            ? { relayContactId: asContactId(parsed.data.contactId) }
            : {}),
        },
        communication: {
          ...state.communication,
          state: 'caregiver_relay',
          // Certainty 1: this is not a classifier guess about the tone of the
          // last message, it is an observed fact about who is holding the
          // phone. The model's own read must not override it on the next turn.
          certainty: 1,
          since: now,
          updatedAt: now,
        },
        updatedAt: now,
      };

      await tools.store.update(state.caseId, state.revision, next);
      await tools.store.appendTimeline(state.caseId, [
        {
          id: asTimelineEntryId(tools.ids.newId('tl')),
          kind: 'relay_handoff',
          provenance: 'system_event',
          summary: 'Caregiver took over the interview',
          detail:
            'Answers from here are given on the patient’s behalf. Tone shifts to clinical precision (§5.5).',
          riskTierAfter: state.risk.tier,
          at: now,
          recordedAt: now,
        },
      ]);

      res.json({ relay: next.relay, mode: next.mode, communicationState: next.communication.state });
    }),
  );

  return router;
}
