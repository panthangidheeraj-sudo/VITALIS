/**
 * Adapter tests. `fetch` is stubbed throughout - these assert how each adapter
 * MAPS a response, not that NIH and WHO are up. A test that hits the real
 * network fails on conference wifi, which is the one place this has to work.
 *
 * The cases chosen are the ones that would otherwise be discovered live: a
 * discontinued endpoint, an expiring token, a source falling through to its
 * backup, and every one of them timing out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { degradationOf } from '@triage/shared';
import { stripMarkup } from './http.js';
import { HealthKnowledgePort } from './knowledge-port.js';
import { Icd11CodingPort } from './icd11-coding-port.js';
import { RxNavMedicationPort } from './rxnav-medication-port.js';

const originalFetch = globalThis.fetch;

/** Routes each request to the first matching URL fragment. */
function stubFetch(routes: Record<string, { status?: number; body: string }>): void {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    const key = Object.keys(routes).find((fragment) => url.includes(fragment));
    if (key === undefined) throw new Error(`Unstubbed request: ${url}`);
    const route = routes[key]!;
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      text: async () => route.body,
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('markup stripping', () => {
  /** Both real cases that produced visible artefacts against the live APIs. */
  it('removes inline highlighting without inserting a space', () => {
    // ICD-11 search wraps matched words; a space here printed "pain , unspecified"
    // on the handoff card.
    expect(stripMarkup("<em class='found'>Chest</em> <em class='found'>pain</em>, unspecified")).toBe(
      'Chest pain, unspecified',
    );
  });

  it('turns block tags into a space so sentences do not weld together', () => {
    expect(stripMarkup('It has many causes.<p>Seek care if sudden.</p>')).toBe(
      'It has many causes. Seek care if sudden.',
    );
  });

  it('decodes escaped markup before stripping it', () => {
    // MedlinePlus returns escaped HTML inside XML. Stripping first leaves these
    // behind, and they decode into visible tags afterwards.
    expect(stripMarkup('Chest pain. &lt;p&gt;Seek care.&lt;/p&gt;')).toBe('Chest pain. Seek care.');
  });
});

// ---------------------------------------------------------------------------

describe('RxNav medication normalisation', () => {
  const port = new RxNavMedicationPort('https://rxnav.test/REST');

  it('resolves a reported name to an RxCUI and the ingredient name', async () => {
    stubFetch({
      'rxcui.json': { body: JSON.stringify({ idGroup: { rxnormId: ['6809'] } }) },
      'allrelated.json': {
        body: JSON.stringify({
          allRelatedGroup: {
            conceptGroup: [
              { tty: 'SBD', conceptProperties: [{ name: 'Glucophage 500 MG Oral Tablet' }] },
              { tty: 'IN', conceptProperties: [{ name: 'metformin' }] },
            ],
          },
        }),
      },
    });

    const result = await port.normalize(['Glucophage']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.rxcui).toBe('6809');
    // The ingredient, not the branded pack description - that is what a doctor
    // reads on a handoff card.
    expect(result.data[0]?.normalizedName).toBe('metformin');
  });

  /**
   * The interaction endpoint was retired in January 2024. An empty list here
   * means NOT CHECKED, never "no interactions found", so nothing in this
   * adapter may populate it. Asserted because the field name invites misuse.
   */
  it('never reports interaction flags', async () => {
    stubFetch({
      'rxcui.json': { body: JSON.stringify({ idGroup: { rxnormId: ['6809'] } }) },
      'allrelated.json': { body: JSON.stringify({}) },
    });

    const result = await port.normalize(['metformin', 'warfarin']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const med of result.data) expect(med.interactionFlags).toEqual([]);
  });

  it('treats an unknown drug name as a clean miss, not a failure', async () => {
    stubFetch({ 'rxcui.json': { body: JSON.stringify({ idGroup: {} }) } });

    const result = await port.normalize(['not-a-real-drug']);
    // A 200 with no match means RxNorm does not know the name - a local brand
    // or a typo. Degrading the whole result for that would cry wolf.
    expect(result.source).toBe('live');
    if (!result.ok) return;
    expect(result.data[0]?.reportedName).toBe('not-a-real-drug');
    expect(result.data[0]?.rxcui).toBeUndefined();
  });

  it('keeps the patient wording and degrades when the lookup fails', async () => {
    stubFetch({ 'rxcui.json': { status: 503, body: '' } });

    const result = await port.normalize(['metformin']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.reportedName).toBe('metformin');
    expect(degradationOf(result)?.conservative).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('ICD-11 coding', () => {
  const config = {
    clientId: 'id',
    clientSecret: 'secret',
    tokenUrl: 'https://icd.test/connect/token',
    baseUrl: 'https://id.test',
    release: '2024-01',
  };

  it('returns the first codable entity with markup stripped from the title', async () => {
    stubFetch({
      '/connect/token': { body: JSON.stringify({ access_token: 't', expires_in: 3600 }) },
      '/mms/search': {
        body: JSON.stringify({
          destinationEntities: [
            // No code: a grouping header, not codable. Must be skipped.
            { id: 'https://id.test/a', title: 'Symptoms of the circulatory system' },
            { id: 'https://id.test/b', theCode: 'MD30.0', title: "<em class='found'>Chest</em> pain" },
          ],
        }),
      },
    });

    const port = new Icd11CodingPort(config);
    const result = await port.codeForCategory({
      chiefComplaint: 'chest pain',
      triageLevel: 'emergency',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.code).toBe('MD30.0');
    expect(result.data.title).toBe('Chest pain');
    expect(result.citation?.provider).toBe('icd11');
  });

  it('requests a token once and reuses it across calls', async () => {
    stubFetch({
      '/connect/token': { body: JSON.stringify({ access_token: 't', expires_in: 3600 }) },
      '/mms/search': {
        body: JSON.stringify({ destinationEntities: [{ theCode: 'MD30.0', title: 'Chest pain' }] }),
      },
    });

    const port = new Icd11CodingPort(config);
    await port.codeForCategory({ chiefComplaint: 'chest pain', triageLevel: 'emergency' });
    await port.codeForCategory({ chiefComplaint: 'headache', triageLevel: 'consultation' });

    const tokenCalls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/connect/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('fails with a conservative notice when the token cannot be obtained', async () => {
    stubFetch({
      '/connect/token': { status: 401, body: '' },
      '/mms/search': { body: '{}' },
    });

    const port = new Icd11CodingPort(config);
    const result = await port.codeForCategory({
      chiefComplaint: 'chest pain',
      triageLevel: 'emergency',
    });

    expect(result.ok).toBe(false);
    // A missing code costs a doctor nothing; the notice says exactly that.
    expect(degradationOf(result)?.conservative).toBe(true);
    expect(degradationOf(result)?.userFacingMessage).toContain('handoff summary is unaffected');
  });
});

// ---------------------------------------------------------------------------

describe('knowledge lookup', () => {
  const config = {
    medlinePlusSearchUrl: 'https://wsearch.test/ws/query',
    wikipediaBaseUrl: 'https://wiki.test',
  };

  const MEDLINE_XML = `<?xml version="1.0"?><nlmSearchResult><list>
    <document rank="0" url="https://medlineplus.gov/chestpain.html">
      <content name="title">&lt;span class="qt0"&gt;Chest&lt;/span&gt; Pain</content>
      <content name="FullSummary">Chest pain has many causes. &lt;p&gt;Seek care if it is sudden.&lt;/p&gt;</content>
    </document></list></nlmSearchResult>`;

  it('prefers MedlinePlus and returns it as a live, cited result', async () => {
    stubFetch({ 'wsearch.test': { body: MEDLINE_XML } });

    const result = await new HealthKnowledgePort(config).explain({ name: 'chest pain' });
    expect(result.source).toBe('live');
    if (!result.ok) return;
    expect(result.data.citation.provider).toBe('medlineplus');
    expect(result.data.text).toContain('Chest pain has many causes');
    // Markup and entities must not reach a patient-facing string.
    expect(result.data.text).not.toContain('<');
  });

  /**
   * The whole reason Wikipedia is a `fallback` and not a `live` result: it is a
   * general source, and the case state has to be able to tell the difference.
   */
  it('falls back to Wikipedia and marks it as degraded, not clinical', async () => {
    stubFetch({
      'wsearch.test': { status: 500, body: '' },
      '/w/rest.php/v1/search/page': {
        body: JSON.stringify({ pages: [{ key: 'Angina', title: 'Angina' }] }),
      },
      '/api/rest_v1/page/summary/': {
        body: JSON.stringify({
          title: 'Angina',
          extract: 'Angina is chest pain caused by reduced blood flow.',
          content_urls: { desktop: { page: 'https://wiki.test/Angina' } },
        }),
      },
    });

    const result = await new HealthKnowledgePort(config).explain({ name: 'angina' });
    expect(result.source).toBe('fallback');
    if (!result.ok) return;
    expect(result.data.citation.provider).toBe('wikipedia');
    expect(degradationOf(result)?.userFacingMessage).toContain('not a medical source');
  });

  it('fails explicitly when both sources are unreachable', async () => {
    stubFetch({
      'wsearch.test': { status: 500, body: '' },
      'wiki.test': { status: 500, body: '' },
    });

    const result = await new HealthKnowledgePort(config).explain({ name: 'chest pain' });
    expect(result.ok).toBe(false);
    // An explanation is a nice-to-have; losing it must not read as alarming.
    expect(degradationOf(result)?.userFacingMessage).toContain('does not change the assessment');
  });

  it('falls through to Wikipedia when MedlinePlus returns unparseable XML', async () => {
    stubFetch({
      'wsearch.test': { body: '<nlmSearchResult><list></list></nlmSearchResult>' },
      '/w/rest.php/v1/search/page': { body: JSON.stringify({ pages: [{ key: 'Angina' }] }) },
      '/api/rest_v1/page/summary/': {
        body: JSON.stringify({ title: 'Angina', extract: 'Angina is chest pain.' }),
      },
    });

    // A format change at NIH degrades the explanation source; it must not
    // throw, and it must not take the turn down.
    const result = await new HealthKnowledgePort(config).explain({ name: 'angina' });
    expect(result.source).toBe('fallback');
  });
});
