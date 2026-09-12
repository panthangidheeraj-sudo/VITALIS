/**
 * WHO ICD-11 - CodingPort.
 *
 * Attaches a standard diagnostic code to a category the system has ALREADY
 * derived, for the Doctor Handoff Timeline (5.3). It does not diagnose and it
 * cannot influence the risk tier: `codeForCategory` takes the chief complaint
 * and the triage level as inputs and returns only a code and a title. There is
 * no path from an ICD-11 response back into scoring - the port interface has no
 * method that could carry one.
 *
 * That separation is the point. A judge should be able to see that the code on
 * the handoff card is a LABEL for a decision Infermedica made, not the decision
 * itself.
 *
 * Auth is OAuth2 client-credentials against WHO's own token service, separate
 * from the API host. Tokens last an hour; this caches until shortly before
 * expiry rather than fetching one per call, because a token round trip on the
 * critical path of a handoff is wasted time.
 */

import type { CodingPort, RiskAssessment, ToolResult } from '@triage/shared';
import { failedResult, liveResult } from '@triage/shared';
import { requestJson, stripMarkup } from './http.js';

export interface Icd11Config {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenUrl: string;
  readonly baseUrl: string;
  /** Pinned release, e.g. "2024-01". Omitted means WHO's current release. */
  readonly release: string | undefined;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
}

interface LinearizationResponse {
  readonly latestRelease?: string;
}

interface SearchResponse {
  readonly destinationEntities?: readonly {
    readonly id?: string;
    readonly theCode?: string;
    readonly title?: string;
  }[];
}

type CodeResult = { readonly code: string; readonly title: string; readonly uri?: string };

/** Refresh this long before the token actually expires, to avoid a race. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

/**
 * Used only if release discovery fails. A release id IS mandatory - verified:
 * `/icd/release/11/mms/search` without one returns 404, it does not redirect to
 * the current release as the docs imply. Pinning a known-good release here
 * means a discovery outage costs us freshness, not the whole feature.
 */
const FALLBACK_RELEASE = '2024-01';

export class Icd11CodingPort implements CodingPort {
  private token: string | undefined;
  private tokenExpiresAtMs = 0;
  private discoveredRelease: string | undefined;

  constructor(private readonly config: Icd11Config) {}

  async codeForCategory(input: {
    readonly chiefComplaint: string;
    readonly triageLevel: RiskAssessment['triageLevel'];
  }): Promise<ToolResult<CodeResult>> {
    const startedAt = Date.now();

    const token = await this.accessToken();
    if (token === undefined) {
      return failedResult(
        {
          kind: 'unauthorized',
          message: 'Could not obtain an ICD-11 access token.',
          retryable: false,
        },
        Date.now() - startedAt,
        this.degradation('unauthorized'),
      );
    }

    const release = await this.release(token);
    const url =
      `${this.config.baseUrl}/icd/release/11/${release}/mms/search` +
      `?q=${encodeURIComponent(input.chiefComplaint)}&flatResults=true`;

    const outcome = await requestJson<SearchResponse>(url, this.headers(token));

    if (!outcome.ok || outcome.value === undefined) {
      return failedResult(
        outcome.error ?? { kind: 'unavailable', message: 'ICD-11 search failed.', retryable: true },
        outcome.latencyMs,
        this.degradation(outcome.error?.kind ?? 'unavailable'),
      );
    }

    // The search ranks by relevance; the first entity carrying an actual code
    // is taken. Entities without `theCode` are grouping headers, not codable.
    const entity = (outcome.value.destinationEntities ?? []).find(
      (e) => typeof e.theCode === 'string' && e.theCode.length > 0,
    );

    if (entity?.theCode === undefined) {
      return failedResult(
        {
          kind: 'invalid_response',
          message: `ICD-11 returned no codable entity for "${input.chiefComplaint}".`,
          retryable: false,
        },
        outcome.latencyMs,
        this.degradation('invalid_response'),
      );
    }

    return liveResult(
      {
        code: entity.theCode,
        // Search results wrap matched terms in <em class='found'> markup.
        title: stripMarkup(entity.title ?? input.chiefComplaint),
        ...(entity.id === undefined ? {} : { uri: entity.id }),
      },
      outcome.latencyMs,
      {
        provider: 'icd11',
        title: `WHO ICD-11: ${stripMarkup(entity.title ?? '')}`,
        ...(entity.id === undefined ? {} : { url: entity.id }),
        retrievedAt: new Date().toISOString(),
      },
    );
  }

  /**
   * The handoff card simply omits the code line when this degrades. That is the
   * correct behaviour: a missing standard code costs a doctor nothing, because
   * the chief complaint, severity and quoted patient words are all still there.
   */
  private degradation(reason: Parameters<typeof failedResult>[0]['kind']) {
    return {
      tool: 'icd11.code',
      reason,
      userFacingMessage:
        'Standard diagnostic coding is unavailable right now. The handoff summary is unaffected - it just will not carry an ICD-11 code.',
      fallbackUsed: 'handoff summary without an ICD-11 code',
      conservative: true,
    };
  }

  private headers(token: string): { readonly headers: Record<string, string> } {
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Language': 'en',
        // Required by the ICD-11 API; omitting it returns a 406.
        'API-Version': 'v2',
      },
    };
  }

  /**
   * An explicit `ICD11_RELEASE` wins. Otherwise the linearization root is asked
   * for its `latestRelease` once and the answer cached for the process
   * lifetime - WHO publishes annually, so re-checking per call would be pure
   * overhead on a path a doctor is waiting on.
   */
  private async release(token: string): Promise<string> {
    if (this.config.release !== undefined) return this.config.release;
    if (this.discoveredRelease !== undefined) return this.discoveredRelease;

    const outcome = await requestJson<LinearizationResponse>(
      `${this.config.baseUrl}/icd/release/11/mms`,
      this.headers(token),
    );
    // e.g. "http://id.who.int/icd/release/11/2026-01/mms" -> "2026-01"
    const match = /\/release\/11\/([^/]+)\/mms/.exec(outcome.value?.latestRelease ?? '');
    this.discoveredRelease = match?.[1] ?? FALLBACK_RELEASE;
    return this.discoveredRelease;
  }

  private async accessToken(): Promise<string | undefined> {
    if (this.token !== undefined && Date.now() < this.tokenExpiresAtMs) return this.token;

    const outcome = await requestJson<TokenResponse>(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: 'icdapi_access',
      }).toString(),
    });

    if (!outcome.ok || outcome.value?.access_token === undefined) {
      this.token = undefined;
      this.tokenExpiresAtMs = 0;
      return undefined;
    }

    this.token = outcome.value.access_token;
    const lifetimeMs = (outcome.value.expires_in ?? 3600) * 1000;
    this.tokenExpiresAtMs = Date.now() + Math.max(0, lifetimeMs - TOKEN_SAFETY_MARGIN_MS);
    return this.token;
  }
}
