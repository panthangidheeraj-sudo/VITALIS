/**
 * Nearby hospitals for the Emergency screen (5.3 UI).
 *
 * `tools.hospitals.findNearby` (OsmHospitalPort) was previously only called
 * from inside `confirmRouting` — there was no client-facing route at all, so
 * the phone had no way to show a hospital list before or during the
 * interview. This is that route: a thin pass-through, no new matching logic.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AgentTools } from '@triage/shared';
import { haversineKm } from '@triage/shared';

const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.5).max(50).default(10),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function createHospitalRoutes(tools: AgentTools): Router {
  const router = Router();

  router.get(
    '/nearby',
    wrap(async (req: Request, res: Response) => {
      const parsed = nearbySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }
      const { lat, lng, radiusKm, limit } = parsed.data;

      const result = await tools.hospitals.findNearby({
        origin: { lat, lng },
        radiusKm,
        limit,
        requireEmergencyDepartment: false,
      });

      if (!result.ok) {
        // The internal message is a diagnostic - it carries the upstream URL
        // and the raw transport error ("https://overpass-api.de/api/
        // interpreter: fetch failed"), which was being rendered verbatim on
        // the Emergency screen. It goes to the server log; the client gets
        // the port's own user-facing sentence, or a safe default.
        console.warn(`[hospitals] lookup failed: ${result.error.message}`);
        res.status(502).json({
          error: 'hospital_lookup_failed',
          message:
            result.degraded?.userFacingMessage ??
            'Nearby hospitals are temporarily unavailable. Please try again.',
        });
        return;
      }

      // Distance is real arithmetic on real coordinates (both from OSM), not
      // an estimate — the port already ranks by it internally but discarded
      // it, so the UI had a `distanceKm` field it read and nothing ever sent.
      res.json({
        hospitals: result.data.map((hospital) => ({
          ...hospital,
          distanceKm: Number(haversineKm({ lat, lng }, hospital.location).toFixed(2)),
        })),
      });
    }),
  );

  return router;
}
