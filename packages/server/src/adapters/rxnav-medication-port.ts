/**
 * RxNorm / RxNav (NIH) - MedicationPort.
 *
 * Keyless and unauthenticated. Used for exactly one thing: turning whatever the
 * patient called their medication ("metformin", "Glucophage", "the sugar
 * tablet") into an RxCUI and a standard name, so the One-Tap Emergency Card and
 * the Doctor Handoff Timeline show something a clinician recognises.
 *
 * WHAT THIS DOES NOT DO - and the code enforces it, not just this comment:
 *
 *   RxNav's drug-drug interaction endpoints were DISCONTINUED in January 2024.
 *   `NormalizedMedication.interactionFlags` therefore always comes back empty
 *   from this adapter. The field is not removed because other sources could
 *   populate it later, but nothing in this file will ever write to it, and no
 *   interaction claim may be derived from an RxNav response.
 *
 *   This matters clinically: an empty interaction list here means "not
 *   checked", NOT "no interactions". Presenting it as the latter would be
 *   exactly the kind of silent degradation 6 forbids.
 *
 * Endpoints used:
 *   /REST/rxcui.json?name={name}        - name to RxCUI
 *   /REST/rxcui/{rxcui}/allrelated.json - RxCUI to the standard SCD/IN names
 */

import type {
  MedicationPort,
  NormalizedMedication,
  ToolResult,
} from '@triage/shared';
import { fallbackResult, liveResult } from '@triage/shared';
import { requestJson } from './http.js';

interface RxcuiResponse {
  readonly idGroup?: { readonly rxnormId?: readonly string[] };
}

interface AllRelatedResponse {
  readonly allRelatedGroup?: {
    readonly conceptGroup?: readonly {
      readonly tty?: string;
      readonly conceptProperties?: readonly { readonly name?: string; readonly rxcui?: string }[];
    }[];
  };
}

/**
 * Preference order for the display name. `IN` is the ingredient ("metformin"),
 * which is what a doctor reading a handoff card wants - not `SBD`, the branded
 * pack description ("Glucophage 500 MG Oral Tablet [Bristol-Myers]").
 */
const NAME_PREFERENCE = ['IN', 'PIN', 'MIN', 'SCD', 'SBD'] as const;

export class RxNavMedicationPort implements MedicationPort {
  constructor(private readonly baseUrl: string) {}

  async normalize(
    reportedNames: readonly string[],
  ): Promise<ToolResult<readonly NormalizedMedication[]>> {
    const startedAt = Date.now();

    const results = await Promise.all(
      reportedNames.map(async (reportedName) => this.normalizeOne(reportedName)),
    );

    const latencyMs = Date.now() - startedAt;
    const normalized = results.map((r) => r.medication);
    const anyLookupFailed = results.some((r) => r.failed);

    if (!anyLookupFailed) {
      return liveResult(normalized, latencyMs, {
        provider: 'rxnorm',
        title: 'RxNorm / RxNav (U.S. National Library of Medicine)',
        url: `${this.baseUrl}/rxcui.json`,
        retrievedAt: new Date().toISOString(),
      });
    }

    // Partial success is still useful - the unresolved entries keep the
    // patient's own wording, which is better than dropping a medication from
    // the handoff card entirely. But it is reported as degraded so the card can
    // show "as reported, not verified" rather than implying a clean lookup.
    return fallbackResult(normalized, latencyMs, {
      tool: 'rxnorm.normalize',
      reason: 'unavailable',
      userFacingMessage:
        'I could not verify every medication name against the national drug database. I have kept them exactly as you reported them.',
      fallbackUsed: 'patient-reported medication names, unverified',
      conservative: true,
    });
  }

  private async normalizeOne(
    reportedName: string,
  ): Promise<{ medication: NormalizedMedication; failed: boolean }> {
    const unresolved: NormalizedMedication = { reportedName, interactionFlags: [] };

    const idOutcome = await requestJson<RxcuiResponse>(
      `${this.baseUrl}/rxcui.json?name=${encodeURIComponent(reportedName)}`,
    );
    if (!idOutcome.ok || idOutcome.value === undefined) {
      return { medication: unresolved, failed: true };
    }

    const rxcui = idOutcome.value.idGroup?.rxnormId?.[0];
    if (rxcui === undefined) {
      // A 200 with no match is not an error - the drug name is simply unknown
      // to RxNorm (a local brand, or a misspelling). Not a failure to report.
      return { medication: unresolved, failed: false };
    }

    const relatedOutcome = await requestJson<AllRelatedResponse>(
      `${this.baseUrl}/rxcui/${encodeURIComponent(rxcui)}/allrelated.json`,
    );
    const normalizedName =
      relatedOutcome.ok && relatedOutcome.value !== undefined
        ? preferredName(relatedOutcome.value)
        : undefined;

    return {
      medication: {
        reportedName,
        rxcui,
        ...(normalizedName === undefined ? {} : { normalizedName }),
        // Never populated. See the file header.
        interactionFlags: [],
      },
      failed: false,
    };
  }
}

function preferredName(response: AllRelatedResponse): string | undefined {
  const groups = response.allRelatedGroup?.conceptGroup ?? [];
  for (const tty of NAME_PREFERENCE) {
    const match = groups.find((g) => g.tty === tty && (g.conceptProperties?.length ?? 0) > 0);
    const name = match?.conceptProperties?.[0]?.name;
    if (name !== undefined && name.length > 0) return name;
  }
  return undefined;
}
