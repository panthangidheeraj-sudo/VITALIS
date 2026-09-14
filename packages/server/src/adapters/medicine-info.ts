/**
 * Trusted medicine information — what a medicine is COMMONLY USED FOR, sourced
 * from the keyless NIH/NLM services this repo already talks to, not from a
 * language model's memory.
 *
 * THE RULE THIS FILE ENFORCES: when a trusted source has an answer, the
 * trusted answer wins and is cited. The vision model's own `usesAndBenefits`
 * string is a LAST RESORT, and when it is used the result says so
 * (`usesSource: 'model'`) so the UI can label it differently. A confident
 * paragraph about a drug with a MedlinePlus logo implied next to it, that in
 * fact came from an LLM, is exactly the kind of laundering this avoids.
 *
 * Three sources, each best-effort and independent — a miss on any one omits
 * that field rather than failing the lookup:
 *   - RxNorm/RxNav (via the existing MedicationPort): the normalised
 *     ingredient name, which is also what makes the other two searches work
 *     when the photo showed a brand name.
 *   - MedlinePlus (via the existing KnowledgePort): consumer-health prose
 *     describing what the drug is used for.
 *   - DailyMed: the official FDA label document, linked rather than quoted.
 *
 * PHRASING IS PART OF THE CONTRACT. Nothing here ever emits "cures" or
 * "treats X" as a promise — callers render `uses` under a "Commonly used for"
 * heading, and `usesCaveat` carries the verification line that must travel
 * with it.
 */

import type { KnowledgePort, MedicationPort } from '@triage/shared';
import { requestJson } from './http.js';

export interface MedicineInfoSource {
  readonly provider: 'rxnorm' | 'medlineplus' | 'dailymed' | 'model';
  readonly title: string;
  readonly url?: string;
}

export interface MedicineInfo {
  /** RxNorm's normalised ingredient name, when the name resolved at all. */
  readonly genericName?: string;
  readonly rxcui?: string;
  /** Consumer-health description of what it is commonly used for. */
  readonly uses?: string;
  /** Where `uses` came from. `'model'` means no trusted source had it. */
  readonly usesSource?: 'medlineplus' | 'model';
  /** Official FDA label, linked (never scraped into prose). */
  readonly labelUrl?: string;
  readonly labelTitle?: string;
  readonly sources: readonly MedicineInfoSource[];
  /** True when RxNorm could not resolve the name at all. */
  readonly identityConfirmed: boolean;
}

interface DailyMedSplsResponse {
  readonly data?: readonly { readonly setid?: string; readonly title?: string }[];
}

/** MedlinePlus Connect's Atom-as-JSON shape. Every value is wrapped in `_value`. */
interface ConnectResponse {
  readonly feed?: {
    readonly entry?: readonly {
      readonly title?: { readonly _value?: string };
      readonly summary?: { readonly _value?: string };
      readonly link?: readonly { readonly href?: string }[];
    }[];
  };
}

/** RxNorm's OID in MedlinePlus Connect's coding-system vocabulary. */
const RXNORM_OID = '2.16.840.1.113883.6.88';

/** Consumer drug pages are long; the card shows a lead-in, not an essay. */
const MAX_USES_CHARS = 420;

/**
 * MedlinePlus CONNECT, not the health-topics search.
 *
 * knowledge-port.ts's header explains why Connect was unusable for symptoms:
 * it is a code-lookup service and the codes we have for what a patient SAYS
 * are Infermedica concept ids, which it does not accept. For a medicine that
 * objection disappears — RxNav has just handed us an RXCUI, which is exactly
 * one of the code systems Connect indexes. So the drug path gets the
 * authoritative NIH consumer-drug page that the symptom path could not, and
 * the health-topics search stays the fallback for names RxNorm could not
 * resolve.
 */
async function medlinePlusByRxcui(
  rxcui: string,
): Promise<{ readonly text: string; readonly title: string; readonly url?: string } | undefined> {
  const outcome = await requestJson<ConnectResponse>(
    `https://connect.medlineplus.gov/service?mainSearchCriteria.v.cs=${RXNORM_OID}` +
      `&mainSearchCriteria.v.c=${encodeURIComponent(rxcui)}&knowledgeResponseType=application/json`,
  ).catch(() => undefined);

  const entry = outcome?.ok === true ? outcome.value?.feed?.entry?.[0] : undefined;
  const summary = entry?.summary?._value;
  const title = entry?.title?._value;
  if (summary === undefined || title === undefined || summary.trim().length === 0) return undefined;

  const trimmed =
    summary.length <= MAX_USES_CHARS ? summary : `${summary.slice(0, summary.lastIndexOf(' ', MAX_USES_CHARS))}…`;
  const href = entry?.link?.[0]?.href;
  return {
    text: trimmed,
    title: `MedlinePlus: ${title}`,
    ...(href !== undefined ? { url: href } : {}),
  };
}

export const USES_CAVEAT =
  'General information about what this medicine is commonly used for. It is not advice about your own dose, and it does not confirm that this medicine is right for you — check with a pharmacist or doctor.';

/**
 * MedlinePlus's health-topic search will return SOMETHING for almost any
 * string, so the same relevance guard the assistant chat route uses applies
 * here: if the returned title shares no distinctive word with the drug name we
 * searched for, it is an off-topic match and is dropped rather than cited.
 * Verified failure mode this prevents: searching "Dolo 650" returning an
 * unrelated topic and it being presented as that drug's uses.
 */
function looksRelevant(searchedName: string, citationTitle: string): boolean {
  const nameWords = searchedName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  if (nameWords.length === 0) return false;
  const title = citationTitle.toLowerCase();
  return nameWords.some((w) => title.includes(w));
}

export async function lookupMedicineInfo(
  productName: string,
  ports: { readonly medication: MedicationPort; readonly knowledge: KnowledgePort },
): Promise<MedicineInfo> {
  const sources: MedicineInfoSource[] = [];

  // 1. RxNorm first — its normalised name is the best search term for the
  //    other two, since a photo usually shows a brand, not an ingredient.
  const normalized = await ports.medication.normalize([productName]).catch(() => undefined);
  const first = normalized?.ok === true ? normalized.data[0] : undefined;
  const genericName = first?.normalizedName;
  const rxcui = first?.rxcui;
  if (genericName !== undefined) {
    sources.push({
      provider: 'rxnorm',
      title: `RxNorm: ${genericName}`,
      ...(rxcui !== undefined ? { url: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${rxcui}` } : {}),
    });
  }

  const searchName = genericName ?? productName;

  // 2 & 3 in parallel — neither is on the critical path.
  //
  // Connect (by RXCUI) is preferred over the health-topics search because it
  // is keyed on an exact code rather than on a string: no relevance guessing,
  // and it returns the consumer DRUG page rather than a disease topic that
  // merely mentions the drug. The search is only attempted when there is no
  // RXCUI to look up.
  const [connect, explained, dailyMed] = await Promise.all([
    rxcui === undefined ? Promise.resolve(undefined) : medlinePlusByRxcui(rxcui),
    rxcui !== undefined ? Promise.resolve(undefined) : ports.knowledge.explain({ name: searchName }).catch(() => undefined),
    requestJson<DailyMedSplsResponse>(
      `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(searchName)}`,
    ).catch(() => undefined),
  ]);

  let uses: string | undefined;
  let usesSource: MedicineInfo['usesSource'];
  if (connect !== undefined) {
    uses = connect.text;
    usesSource = 'medlineplus';
    sources.push({ provider: 'medlineplus', title: connect.title, ...(connect.url !== undefined ? { url: connect.url } : {}) });
  } else if (
    explained?.ok === true &&
    explained.data.citation.provider === 'medlineplus' &&
    looksRelevant(searchName, explained.data.citation.title)
  ) {
    uses = explained.data.text;
    usesSource = 'medlineplus';
    sources.push({
      provider: 'medlineplus',
      title: explained.data.citation.title,
      ...(explained.data.citation.url !== undefined ? { url: explained.data.citation.url } : {}),
    });
  }

  const spl = dailyMed?.ok === true ? dailyMed.value?.data?.[0] : undefined;
  const labelUrl =
    spl?.setid === undefined
      ? undefined
      : `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${spl.setid}`;
  if (labelUrl !== undefined) {
    sources.push({
      provider: 'dailymed',
      title: spl?.title ?? `DailyMed label: ${searchName}`,
      url: labelUrl,
    });
  }

  return {
    ...(genericName !== undefined ? { genericName } : {}),
    ...(rxcui !== undefined ? { rxcui } : {}),
    ...(uses !== undefined ? { uses } : {}),
    ...(usesSource !== undefined ? { usesSource } : {}),
    ...(labelUrl !== undefined ? { labelUrl } : {}),
    ...(spl?.title !== undefined ? { labelTitle: spl.title } : {}),
    sources,
    identityConfirmed: genericName !== undefined,
  };
}
