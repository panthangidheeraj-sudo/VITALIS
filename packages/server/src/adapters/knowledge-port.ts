/**
 * KnowledgePort - MedlinePlus first, Wikipedia as a declared fallback.
 *
 * ONE CORRECTION TO THE PLAN, worth knowing before editing this file:
 *
 *   MedlinePlus Connect (connect.medlineplus.gov, the URL in .env.example) does
 *   NOT accept free text. It is a code-lookup service: you hand it an ICD-10,
 *   SNOMED CT or RxCUI code and it returns the matching consumer-health page.
 *   We do not have SNOMED codes for what a patient says - that is exactly the
 *   gap Infermedica's /parse fills, and its concept ids are not SNOMED.
 *
 *   So this adapter uses the MedlinePlus WEB SERVICE (wsearch.nlm.nih.gov)
 *   instead, which does take free text against the health-topics database. Same
 *   publisher (NIH/NLM), same consumer-health content, also keyless. Connect
 *   becomes usable later if ICD-11 coding is wired into the same lookup.
 *
 * WHY WIKIPEDIA IS A `fallbackResult`, NOT A `liveResult`:
 *
 *   Wikipedia is a general-explanation source, not a clinical one. Returning it
 *   as a clean live result would make it indistinguishable from NIH content in
 *   the case state, on the timeline, and on the handoff card. Returning it as a
 *   fallback forces a DegradationNotice to exist, which the UI already renders
 *   - so the patient is told where the explanation came from. That is 6's
 *   "never present a lower-confidence result as if it were full output",
 *   applied to the knowledge layer rather than the scoring layer.
 *
 *   Neither source can ever classify: `KnowledgePort` has no method that
 *   returns a tier or a severity.
 */

import type { ConceptId, Explanation, KnowledgePort, ToolResult } from '@triage/shared';
import { failedResult, fallbackResult, liveResult } from '@triage/shared';
import { firstSentences, requestJson, requestText, stripMarkup } from './http.js';

export interface KnowledgeConfig {
  /** MedlinePlus web service, e.g. https://wsearch.nlm.nih.gov/ws/query */
  readonly medlinePlusSearchUrl: string;
  /** Wikipedia REST root, e.g. https://en.wikipedia.org */
  readonly wikipediaBaseUrl: string;
}

interface WikipediaSearchResponse {
  readonly pages?: readonly { readonly key?: string; readonly title?: string }[];
}

interface WikipediaSummaryResponse {
  readonly extract?: string;
  readonly title?: string;
  readonly content_urls?: { readonly desktop?: { readonly page?: string } };
}

/** Explanations are read aloud during an emergency. Keep them short. */
const MAX_EXPLANATION_CHARS = 400;

export class HealthKnowledgePort implements KnowledgePort {
  constructor(private readonly config: KnowledgeConfig) {}

  async explain(concept: {
    readonly name: string;
    readonly conceptId?: ConceptId;
  }): Promise<ToolResult<Explanation>> {
    const startedAt = Date.now();

    const medline = await this.fromMedlinePlus(concept.name);
    if (medline !== undefined) {
      return liveResult(medline, Date.now() - startedAt, medline.citation);
    }

    const wikipedia = await this.fromWikipedia(concept.name);
    if (wikipedia !== undefined) {
      return fallbackResult(wikipedia, Date.now() - startedAt, {
        tool: 'wikipedia.summary',
        reason: 'unavailable',
        userFacingMessage:
          'I could not reach the NIH health library for this one, so this explanation comes from Wikipedia - general background, not a medical source.',
        fallbackUsed: 'Wikipedia summary',
        conservative: true,
      });
    }

    return failedResult(
      {
        kind: 'unavailable',
        message: `No explanation found for "${concept.name}" in MedlinePlus or Wikipedia.`,
        retryable: true,
      },
      Date.now() - startedAt,
      {
        tool: 'medlineplus.explain',
        reason: 'unavailable',
        userFacingMessage:
          'I could not look up an explanation for that right now. It does not change the assessment.',
        fallbackUsed: 'no explanation shown',
        conservative: true,
      },
    );
  }

  /**
   * The web service answers in XML, and pulling in an XML parser for four
   * fields is not worth the dependency. The extraction below is regex-based and
   * therefore brittle by construction - which is precisely why a failure here
   * returns undefined and falls through to Wikipedia rather than throwing. A
   * format change degrades the explanation source; it does not break triage.
   */
  private async fromMedlinePlus(term: string): Promise<Explanation | undefined> {
    const url =
      `${this.config.medlinePlusSearchUrl}?db=healthTopics` +
      `&term=${encodeURIComponent(term)}&retmax=1`;

    const outcome = await requestText(url);
    if (!outcome.ok || outcome.value === undefined) return undefined;

    const xml = outcome.value;
    const summary = matchContent(xml, 'FullSummary') ?? matchContent(xml, 'snippet');
    const title = matchContent(xml, 'title');
    const pageUrl = /<document[^>]*\burl="([^"]+)"/.exec(xml)?.[1];

    if (summary === undefined) return undefined;

    const text = firstSentences(stripMarkup(summary), MAX_EXPLANATION_CHARS);
    if (text.length === 0) return undefined;

    return {
      text,
      citation: {
        provider: 'medlineplus',
        title: `MedlinePlus: ${title === undefined ? term : stripMarkup(title)}`,
        ...(pageUrl === undefined ? {} : { url: stripMarkup(pageUrl) }),
        retrievedAt: new Date().toISOString(),
      },
    };
  }

  private async fromWikipedia(term: string): Promise<Explanation | undefined> {
    const search = await requestJson<WikipediaSearchResponse>(
      `${this.config.wikipediaBaseUrl}/w/rest.php/v1/search/page` +
        `?q=${encodeURIComponent(term)}&limit=1`,
    );
    const key = search.ok ? search.value?.pages?.[0]?.key : undefined;
    if (key === undefined) return undefined;

    const summary = await requestJson<WikipediaSummaryResponse>(
      `${this.config.wikipediaBaseUrl}/api/rest_v1/page/summary/${encodeURIComponent(key)}`,
    );
    const extract = summary.ok ? summary.value?.extract : undefined;
    if (extract === undefined || extract.length === 0) return undefined;

    return {
      text: firstSentences(stripMarkup(extract), MAX_EXPLANATION_CHARS),
      citation: {
        provider: 'wikipedia',
        title: `Wikipedia: ${summary.value?.title ?? term}`,
        ...(summary.value?.content_urls?.desktop?.page === undefined
          ? {}
          : { url: summary.value.content_urls.desktop.page }),
        retrievedAt: new Date().toISOString(),
      },
    };
  }
}

/** Pulls `<content name="X">...</content>` out of a MedlinePlus wsearch document. */
function matchContent(xml: string, name: string): string | undefined {
  const pattern = new RegExp(`<content name="${name}"[^>]*>([\\s\\S]*?)</content>`, 'i');
  return pattern.exec(xml)?.[1];
}
