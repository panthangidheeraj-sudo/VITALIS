/**
 * The HTTP surface. Four endpoints, no decision logic of its own — every route
 * validates input, calls into @triage/agent, and returns the resulting state.
 * Any clinical or routing judgement that appears to happen here is actually
 * happening in the loop or in `risk-policy.ts`.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AgentTools, CaseId, CaseState } from '@triage/shared';
import {
  PRESS_AND_HOLD_DURATION_MS,
  RevisionConflictError,
  asCaseId,
  requiredGate,
} from '@triage/shared';
import { CaseNotFoundError, GateNotSatisfiedError, confirmRouting, runTurn } from '@triage/agent';
import { buildNewCase } from '../case-factory.js';
import { notifyContacts, type NotifiableContact } from '../notify/notify-contacts.js';
import { createRelayRoutes } from './relay.js';
import { compact } from '../util/compact.js';

/**
 * Emergency contacts, sent by the device alongside the confirmation.
 *
 * The medical profile is still device-local demo data by the user's explicit
 * instruction, so the contact list arrives with the request rather than being
 * read from `patients/{ownerUid}`. What that does and does not assume is
 * spelled out in the header of notify-contacts.ts; it is a deliberate,
 * documented shortcut with a one-line exit, not an oversight.
 */
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

const createCaseSchema = z.object({
  /**
   * Firebase Auth uid from the device's anonymous sign-in. Required: it is what
   * firebase/firestore.rules matches on, so a case created without it is
   * written successfully and then invisible to every listener.
   */
  ownerUid: z.string().min(1).max(128),
  ageYears: z.number().int().min(0).max(130),
  sex: z.enum(['male', 'female']),
  language: z.enum(['en', 'hi', 'te', 'ta']).optional(),
  displayName: z.string().max(120).optional(),
});

const turnSchema = z.object({
  kind: z.enum(['text', 'voice_transcript', 'photo', 'quick_select', 'vital', 'system_tick']),
  text: z.string().max(2048).optional(),
  photoRef: z.string().max(512).optional(),
  quickSelectTags: z.array(z.string().max(64)).max(11).optional(),
  fromCaregiver: z.boolean().optional(),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  source: z
    .enum(['browser_geolocation', 'manual_entry', 'caregiver_report', 'fixture'])
    .default('browser_geolocation'),
});

const confirmSchema = z.object({
  /**
   * How long the user actually held the button, measured on the device.
   *
   * Being straight about what this does and does not achieve: it is not
   * tamper-proof — a crafted request could claim any number. The threat model
   * in §5.2 is ACCIDENTAL triggering (a pocket tap, a child pressing the
   * screen), not a determined attacker, and against that this is effective.
   * Validating it here rather than trusting a client-side `confirmed: true`
   * flag at least means the gate has one definition, enforced in one place,
   * for every client that ever talks to this server.
   */
  heldMs: z.number().min(0).max(60_000),

  /**
   * Who to tell, and whether the patient agreed to share where they are.
   *
   * Both optional and both default to NOT contacting anyone. A confirmation
   * that omits them still dispatches - the routing decision is the safety-
   * critical part and must never depend on a notification list being present -
   * it simply tells nobody. The opposite default would mean a malformed client
   * request silently messaging a family.
   */
  contacts: z.array(contactSchema).max(10).optional(),
  patientName: z.string().min(1).max(120).optional(),
  /**
   * Location is shared ONLY when this is true. It rides on the same 3-second
   * hold as the dispatch itself: 5.5 requires location sharing to be an
   * explicit act, and silently attaching coordinates to an alert would make
   * this a tracking feature the patient never opted into.
   */
  shareLocation: z.boolean().default(false),
});

/**
 * Routes a rejected promise into Express's error handler.
 *
 * Express 4 does not await async handlers, so a rejection escapes as an
 * unhandled rejection and Node terminates the process. That is not theoretical
 * here: a misconfigured Firestore (credential valid, database not yet created)
 * took the whole server down on the first request instead of returning a 500
 * that says what is wrong. An emergency orchestrator that dies on a backend
 * fault is strictly worse than one that reports the fault.
 */
function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function toCaseId(req: Request): CaseId {
  return asCaseId(req.params['id'] as string);
}

/** Trimmed view for the client. The phone reads live state from Firestore. */
function summarize(state: CaseState) {
  return {
    caseId: state.caseId,
    revision: state.revision,
    status: state.status,
    riskTier: state.risk.tier,
    triageLevel: state.risk.triageLevel,
    scoringSource: state.risk.source,
    degraded: state.degradation.clinicalScoringDegraded,
    degradationNotice: state.degradation.notice,
    confidence: { score: state.confidence.score, level: state.confidence.level },
    confidenceAlertActive: state.confidence.alertActive,
    communicationState: state.communication.state,
    turnCount: state.turnCount,
    routing: state.routing,
    dispatch: state.dispatch,
    escalation: state.escalation,
  };
}

export function createCaseRoutes(tools: AgentTools): Router {
  const router = Router();

  // --- Create a case ------------------------------------------------------
  router.post('/', wrap(async (req: Request, res: Response) => {
    const parsed = createCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    const state = buildNewCase(compact(parsed.data), tools);
    await tools.store.create(state);
    res.status(201).json(summarize(state));
  }));

  // --- Read a case (mobile normally uses a Firestore listener instead) -----
  router.get('/:id', wrap(async (req: Request, res: Response) => {
    const state = await tools.store.get(toCaseId(req));
    if (state === undefined) {
      res.status(404).json({ error: 'case_not_found' });
      return;
    }
    res.json(state);
  }));

  // --- Submit a turn: this is the ODAEA loop ------------------------------
  router.post('/:id/turns', wrap(async (req: Request, res: Response) => {
    const parsed = turnSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }

    const result = await runTurn(
      toCaseId(req),
      { ...compact(parsed.data), receivedAt: tools.clock.now() },
      tools,
    );

    res.json({
      ...summarize(result.state),
      turn: {
        id: result.turn.id,
        index: result.turn.index,
        decidedAction: result.turn.decidedAction,
        question: result.turn.question,
        adaptation: result.turn.adaptation,
        extractedEvidence: result.turn.extractedEvidence.length,
        toolCallCount: result.turn.toolCallIds.length,
      },
    });
  }));

  // --- Report where the patient is ---------------------------------------
  /**
   * Hospital matching (5.3) reads `lastKnownLocation` and does nothing at all
   * without it. Nothing in the system was writing that field, so the hospital
   * port was reachable in theory and dead in practice - the same shape of bug
   * as Companion Mode's unreachable tick. This is the writer.
   *
   * Kept as its own endpoint rather than a field on `createCase`, because a
   * location fix arrives on the device's schedule, not the case's: permission
   * prompts, a cold GPS, and a move between rooms all produce it late or
   * repeatedly. Folding it into creation would mean blocking the emergency
   * button behind a permission dialog.
   *
   * A REFUSED PERMISSION IS NOT AN ERROR. The app simply never calls this, the
   * case carries no location, and routing still works - the patient is told
   * which kind of facility to go to rather than which one. Degrading that way
   * is far better than making location mandatory for an emergency assessment.
   */
  router.post('/:id/location', wrap(async (req: Request, res: Response) => {
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    const caseId = toCaseId(req);
    const state = await tools.store.get(caseId);
    if (state === undefined) {
      res.status(404).json({ error: 'case_not_found' });
      return;
    }

    const now = tools.clock.now();
    await tools.store.update(caseId, state.revision, {
      ...state,
      revision: state.revision + 1,
      lastKnownLocation: {
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        at: now,
        source: parsed.data.source,
      },
      updatedAt: now,
    });

    // No timeline entry: a position update is not a clinical event, and one
    // entry per GPS fix would bury the symptoms under a movement log.
    res.json({ ok: true });
  }));

  // --- Confirm a proposed routing decision (the safety gate) --------------
  router.post('/:id/confirm', wrap(async (req: Request, res: Response) => {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }

    const caseId = toCaseId(req);
    const state = await tools.store.get(caseId);
    if (state === undefined) {
      res.status(404).json({ error: 'case_not_found' });
      return;
    }
    if (state.routing === undefined) {
      res.status(409).json({ error: 'no_routing_proposed' });
      return;
    }

    // The gate requirement comes from the policy, keyed only on the outcome —
    // never from what the client says it needs.
    const required = requiredGate(state.routing.outcome);
    if (required.kind === 'press_and_hold_3s' && parsed.data.heldMs < PRESS_AND_HOLD_DURATION_MS) {
      res.status(400).json({
        error: 'gate_not_satisfied',
        requiredHoldMs: PRESS_AND_HOLD_DURATION_MS,
        heldMs: parsed.data.heldMs,
      });
      return;
    }

    const now = tools.clock.now();
    const satisfied: CaseState = {
      ...state,
      routing: { ...state.routing, gate: { ...required, state: 'satisfied', satisfiedAt: now } },
    };

    const result = await confirmRouting(satisfied, tools, now);

    // Contacts are notified HERE rather than inside confirmRouting, because the
    // contact list belongs to the patient profile and not to the case snapshot
    // the loop receives. See the comment at the end of confirm-routing.ts.
    //
    // Sequenced AFTER the routing action, deliberately: if Twilio is slow or
    // down, the ambulance request has already been made and the hospital
    // already matched. Nothing about the clinical outcome waits on a message.
    const contacts = parsed.data.contacts ?? [];
    const notified =
      contacts.length > 0
        ? await notifyContacts(result.nextState, contacts as readonly NotifiableContact[], tools, {
            kind: 'emergency_alert',
            patientName: parsed.data.patientName ?? 'Your contact',
            ...(parsed.data.shareLocation && state.lastKnownLocation !== undefined
              ? { location: state.lastKnownLocation }
              : {}),
          })
        : undefined;

    const finalState: CaseState = {
      ...result.nextState,
      revision: state.revision + 1,
      ...(notified !== undefined
        ? { notifications: [...result.nextState.notifications, ...notified.records] }
        : {}),
    };

    await tools.store.update(caseId, state.revision, finalState);
    await tools.store.appendTimeline(caseId, [
      ...result.timeline,
      ...(notified?.timeline ?? []),
    ]);
    for (const call of [...result.toolCalls, ...(notified?.toolCalls ?? [])]) {
      await tools.store.appendToolCall(caseId, call);
    }

    res.json({
      ...summarize(finalState),
      notifications: (notified?.records ?? []).map((r) => ({
        contactId: r.contactId,
        channel: r.channel,
        status: r.status,
        ...(r.failureReason !== undefined ? { failureReason: r.failureReason } : {}),
      })),
    });
  }));

  // --- Cancel an active alert (§5.2: always available) --------------------
  router.post('/:id/cancel', wrap(async (req: Request, res: Response) => {
    const caseId = toCaseId(req);
    const state = await tools.store.get(caseId);
    if (state === undefined) {
      res.status(404).json({ error: 'case_not_found' });
      return;
    }

    const now = tools.clock.now();
    const next: CaseState = {
      ...state,
      revision: state.revision + 1,
      status: 'cancelled',
      dispatch: { ...state.dispatch, status: 'cancelled', cancelledAt: now, cancelledBy: 'patient' },
      ...(state.routing !== undefined
        ? { routing: { ...state.routing, cancelledAt: now } }
        : {}),
      updatedAt: now,
      closedAt: now,
    };

    await tools.store.update(caseId, state.revision, next);
    await tools.store.appendTimeline(caseId, [
      {
        id: tools.ids.newId('tl') as never,
        kind: 'routing_cancelled',
        provenance: 'system_event',
        summary: 'Alert cancelled by the patient',
        riskTierAfter: state.risk.tier,
        at: now,
        recordedAt: now,
      },
    ]);

    res.json(summarize(next));
  }));

  // Family Relay Mode (5.5) — mounted under the case it belongs to.
  router.use('/:id/relay', createRelayRoutes(tools));

  return router;
}

/** Maps domain errors onto status codes. Registered after the routes. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: unknown,
): void {
  if (err instanceof CaseNotFoundError) {
    res.status(404).json({ error: 'case_not_found', message: err.message });
    return;
  }
  if (err instanceof RevisionConflictError) {
    // The loop already retries once; reaching here means sustained contention.
    res.status(409).json({ error: 'revision_conflict', message: err.message });
    return;
  }
  if (err instanceof GateNotSatisfiedError) {
    res.status(400).json({ error: 'gate_not_satisfied', message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'internal_error', message });
}
