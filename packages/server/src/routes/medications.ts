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
import { requestJson } from '../adapters/http.js';
import type { GeminiConfig } from '../adapters/gemini-vision-port.js';
import { identifyMedicine } from '../adapters/gemini-medicine-vision.js';
import { lookupMedicineInfo, USES_CAVEAT } from '../adapters/medicine-info.js';

const lookupSchema = z.object({
  /** Names as read off the packaging, or typed by the patient. */
  names: z.array(z.string().min(1).max(120)).min(1).max(10),
});

const referenceSchema = z.object({
  name: z.string().min(1).max(120),
});

const identifySchema = z.object({
  /** `data:image/...;base64,...` — see gemini-medicine-vision.ts's DATA_URL guard. */
  photoRef: z.string().min(1).max(8_000_000),
});

interface PubChemPropertyResponse {
  readonly PropertyTable?: {
    readonly Properties?: readonly {
      readonly CID?: number;
      readonly MolecularFormula?: string;
      readonly IUPACName?: string;
    }[];
  };
}

interface DailyMedSplsResponse {
  readonly data?: readonly { readonly setid?: string; readonly title?: string }[];
}

export const INTERACTION_NOTICE =
  'Drug interactions are NOT checked. This lookup confirms what a medicine is, not whether it is safe alongside anything else. Ask a pharmacist or doctor.';

function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function createMedicationRoutes(tools: AgentTools, gemini?: GeminiConfig): Router {
  const router = Router();

  /**
   * Camera -> medicine identification. Reuses the same Gemini vision
   * credential/config the injury-photo endpoint already uses (see
   * gemini-medicine-vision.ts's header) - no second AI pipeline.
   *
   * `gemini` is undefined when GEMINI_API_KEY isn't configured; that is an
   * honest, expected state (same pattern as `chatPort === undefined` in
   * routes/assistant.ts), not an error to hide behind a 500.
   */
  router.post(
    '/identify',
    wrap(async (req: Request, res: Response) => {
      if (gemini === undefined) {
        res.status(503).json({
          error: 'vision_unavailable',
          message: 'Medicine photo identification is not configured on this server.',
        });
        return;
      }

      const parsed = identifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }

      const outcome = await identifyMedicine(gemini, parsed.data.photoRef);
      if (!outcome.ok) {
        res.status(502).json({ error: 'identify_failed', message: outcome.message });
        return;
      }

      // Trusted-source enrichment (RxNorm → MedlinePlus → DailyMed), the same
      // lookup the Assistant's camera path uses, so the standalone scanner and
      // the chat flow can never disagree about what a medicine is used for.
      // Skipped when nothing legible was extracted — there is nothing to look
      // up, and searching on a guess would launder it into a citation.
      const lookupName = outcome.data.genericName ?? outcome.data.productName;
      const info = lookupName === undefined ? undefined : await lookupMedicineInfo(lookupName, tools);

      const uses = info?.uses ?? outcome.data.usesAndBenefits;
      const usesSource =
        info?.uses !== undefined
          ? info.usesSource
          : outcome.data.usesAndBenefits !== undefined
            ? ('model' as const)
            : undefined;

      res.json({
        medicine: {
          ...outcome.data,
          genericName: outcome.data.genericName ?? info?.genericName,
          uses,
          usesSource,
          usesCaveat: uses === undefined ? undefined : USES_CAVEAT,
          rxcui: info?.rxcui,
          labelUrl: info?.labelUrl,
        },
        sources: info?.sources ?? [],
        interactionsChecked: false,
        interactionNotice: INTERACTION_NOTICE,
      });
    }),
  );

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

  /**
   * Reference lookup — chemical formula (PubChem) and an official FDA label
   * link (DailyMed), alongside the RxNorm normalisation above. Both are
   * keyless, free NIH/NLM services, and both are best-effort: a miss on
   * either just omits that field rather than failing the request, the same
   * "supplementary, never on the critical path" treatment `http.ts` gives
   * knowledge/coding lookups.
   *
   * STILL NOT INTERACTION DATA. DailyMed's label text contains warnings
   * prose, not a structured interaction check, so `INTERACTION_NOTICE`
   * applies here exactly as it does above.
   */
  router.get(
    '/reference',
    wrap(async (req: Request, res: Response) => {
      const parsed = referenceSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
        return;
      }
      const name = parsed.data.name;

      const [pubchem, dailyMed] = await Promise.all([
        requestJson<PubChemPropertyResponse>(
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/MolecularFormula,IUPACName/JSON`,
        ),
        requestJson<DailyMedSplsResponse>(
          `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(name)}`,
        ),
      ]);

      const property = pubchem.ok ? pubchem.value?.PropertyTable?.Properties?.[0] : undefined;
      const spl = dailyMed.ok ? dailyMed.value?.data?.[0] : undefined;

      res.json({
        name,
        pubchem:
          property === undefined
            ? undefined
            : {
                cid: property.CID,
                molecularFormula: property.MolecularFormula,
                iupacName: property.IUPACName,
              },
        dailyMed:
          spl?.setid === undefined
            ? undefined
            : {
                title: spl.title,
                labelUrl: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${spl.setid}`,
              },
        interactionsChecked: false,
        interactionNotice: INTERACTION_NOTICE,
      });
    }),
  );

  return router;
}
