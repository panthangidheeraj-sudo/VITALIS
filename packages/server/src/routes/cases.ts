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
import { compact } from '../util/compact.js';

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
    await tools.store.update(caseId, state.revision, {
      ...result.nextState,
      revision: state.revision + 1,
    });
    await tools.store.appendTimeline(caseId, result.timeline);
    for (const call of result.toolCalls) await tools.store.appendToolCall(caseId, call);

    res.json(summarize({ ...result.nextState, revision: state.revision + 1 }));
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
