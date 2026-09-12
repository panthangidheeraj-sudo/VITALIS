/**
 * Medication lookup for the Medicine Scanner (5.6 / emergency card).
 *
 * ONE THING THIS DELIBERATELY DOES NOT DO: drug-drug interaction checking.
 *
 * The feature request asked for "expiry, dosage, interaction info". The first
 * two come off the label. The third is not available from any free source we
 * have: RxNav's interaction endpoints were retired in January 2024, and no
 * other keyless API exposes them. Rather than quietly omit it, every response
 * carries `interactionsChecked: false` and a sentence the UI is expected to
 * show, because "no interactions listed" read as "no interactions exist" is
 * the kind of silent gap that gets someone hurt.
 *
 * What it does provide: RxNorm normalisation, so "the sugar tablet" or a local
 * brand name becomes a standard ingredient name a hospital system recognises
 * on the handoff card.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AgentTools } from '@triage/shared';
import { degradationOf } from '@triage/shared';

const lookupSchema = z.object({
  /** Names as read off the packaging, or typed by the patient. */
  names: z.array(z.string().min(1).max(120)).min(1).max(10),
});

export const INTERACTION_NOTICE =
  'Drug interactions are NOT checked. This lookup confirms what a medicine is, not whether it is safe alongside anything else. Ask a pharmacist or doctor.';

function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function createMedicationRoutes(tools: AgentTools): Router {
  const router = Router();

  router.post(
    '/normalize',
    wrap(async (req: Request, res: Response) => {
      const parsed = lookupSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }

      const result = await tools.medication.normalize(parsed.data.names);
      if (!result.ok) {
        res.status(502).json({
          error: 'lookup_failed',
          message: result.error.message,
          degradationNotice: result.degraded.userFacingMessage,
          interactionsChecked: false,
          interactionNotice: INTERACTION_NOTICE,
        });
        return;
      }

      res.json({
        medications: result.data,
        source: result.source,
        verified: result.source === 'live',
        degradationNotice: degradationOf(result)?.userFacingMessage,
        // Sent on every response, including the clean ones. A field that only
        // appears on failure teaches the client to ignore it.
        interactionsChecked: false,
        interactionNotice: INTERACTION_NOTICE,
      });
    }),
  );

  return router;
}
