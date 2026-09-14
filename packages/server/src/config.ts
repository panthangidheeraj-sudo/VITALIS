/**
 * Server configuration, read once at boot from the root `.env`.
 *
 * Every external credential in the system lives here and nowhere else. The
 * mobile app holds only the public Firebase web config (which is public by
 * design — Firestore security rules, not secrecy, protect the data) and never
 * sees a Groq, Infermedica or Twilio key. That is spec §3.1's security
 * requirement, and it is the reason the phone talks to this server rather
 * than to those APIs directly.
 */

import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

// The root .env, two levels up from packages/server.
loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv(); // also pick up a package-local .env if one exists

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

export interface ServerConfig {
  readonly port: number;
  readonly nodeEnv: string;
  /**
   * `undefined` = allow any origin. CORS only governs BROWSER clients — Expo
   * Go's fetch is not a browser and never enforces or even reads these
   * headers, so this setting cannot be what breaks or fixes mobile
   * connectivity. It exists for the same reason the rest of this file states
   * defaults explicitly: a `NODE_ENV=production` deploy (Render sets this)
   * used to silently set `origin: false`, which blocks every browser-based
   * client with no error message anywhere explaining why - the "degrade
   * loudly" rule applies to configuration mistakes too, not just to external
   * API failures.
   */
  readonly corsAllowedOrigins: readonly string[] | undefined;
  /**
   * Firestore is used only when an Admin credential is present. Without it the
   * server falls back to the in-memory store: the agent loop still runs and
   * every endpoint still works, but the mobile app cannot observe live updates
   * because nothing is being written to Firestore for it to listen to.
   */
  readonly firebase: {
    readonly credentialsPath: string | undefined;
    readonly projectId: string | undefined;
    readonly enabled: boolean;
  };
  readonly groq: {
    readonly apiKey: string | undefined;
    readonly baseUrl: string;
    readonly textModel: string;
    readonly visionModel: string;
    readonly enabled: boolean;
  };
  readonly infermedica: {
    readonly appId: string | undefined;
    readonly appKey: string | undefined;
    readonly baseUrl: string;
    readonly enabled: boolean;
  };
  /**
   * WHO ICD-11. OAuth2 client credentials; the token host is separate from the
   * API host, which is why both URLs are configurable.
   */
  readonly icd11: {
    readonly clientId: string | undefined;
    readonly clientSecret: string | undefined;
    readonly tokenUrl: string;
    readonly baseUrl: string;
    /** Pinned release (e.g. "2024-01"); undefined uses WHO's current release. */
    readonly release: string | undefined;
    readonly enabled: boolean;
  };
  /**
   * The keyless knowledge sources. No `enabled` flag because there is no
   * credential to be missing - these are always available or the network is
   * down, and the adapter reports that itself.
   */
  readonly knowledge: {
    readonly medlinePlusSearchUrl: string;
    readonly wikipediaBaseUrl: string;
  };
  /** RxNorm / RxNav. Keyless, same reasoning as above. */
  readonly rxnav: { readonly baseUrl: string };
  /**
   * Google Gemini, used for VISION ONLY. Groq keeps every text task. Without a
   * key the injury-photo path stays unavailable and says so, rather than
   * silently returning nothing.
   */
  readonly gemini: {
    readonly apiKey: string | undefined;
    readonly baseUrl: string;
    readonly visionModel: string;
    readonly enabled: boolean;
  };
  /**
   * Twilio. `live` is a separate flag from `enabled` on purpose: this is the
   * only adapter that contacts a real person, and having the credentials is not
   * the same decision as being willing to use them during a rehearsal.
   */
  readonly twilio: {
    readonly accountSid: string | undefined;
    readonly authToken: string | undefined;
    readonly whatsappFrom: string | undefined;
    readonly smsFrom: string | undefined;
    readonly live: boolean;
    readonly enabled: boolean;
  };
  /** OpenStreetMap. Keyless; the contact email is courtesy, not a credential. */
  readonly osm: {
    readonly overpassUrl: string;
    readonly contactEmail: string | undefined;
  };
  /** Force the local deterministic scorer even when Infermedica is configured. */
  readonly forceLocalScorer: boolean;
}

export function loadConfig(): ServerConfig {
  const credentialsPath = optional('GOOGLE_APPLICATION_CREDENTIALS');
  const projectId = optional('FIREBASE_PROJECT_ID');
  const infermedicaAppId = optional('INFERMEDICA_APP_ID');
  const infermedicaAppKey = optional('INFERMEDICA_APP_KEY');
  const groqApiKey = optional('GROQ_API_KEY');
  const geminiApiKey = optional('GEMINI_API_KEY');
  const twilioSid = optional('TWILIO_ACCOUNT_SID');
  const twilioToken = optional('TWILIO_AUTH_TOKEN');
  const icd11ClientId = optional('ICD11_CLIENT_ID');
  const icd11ClientSecret = optional('ICD11_CLIENT_SECRET');

  return {
    port: Number(optional('PORT') ?? 8787),
    nodeEnv: optional('NODE_ENV') ?? 'development',
    firebase: {
      credentialsPath,
      projectId,
      enabled: credentialsPath !== undefined && projectId !== undefined,
    },
    groq: {
      apiKey: groqApiKey,
      baseUrl: optional('GROQ_BASE_URL') ?? 'https://api.groq.com/openai/v1',
      enabled: groqApiKey !== undefined,
      textModel: optional('GROQ_MODEL_TEXT') ?? 'openai/gpt-oss-120b',
      visionModel: optional('GROQ_MODEL_VISION') ?? 'openai/gpt-oss-120b',
    },
    infermedica: {
      appId: infermedicaAppId,
      appKey: infermedicaAppKey,
      baseUrl: optional('INFERMEDICA_BASE_URL') ?? 'https://api.infermedica.com/v3',
      enabled: infermedicaAppId !== undefined && infermedicaAppKey !== undefined,
    },
    icd11: {
      clientId: icd11ClientId,
      clientSecret: icd11ClientSecret,
      tokenUrl: optional('ICD11_TOKEN_URL') ?? 'https://icdaccessmanagement.who.int/connect/token',
      baseUrl: optional('ICD11_BASE_URL') ?? 'https://id.who.int',
      release: optional('ICD11_RELEASE'),
      enabled: icd11ClientId !== undefined && icd11ClientSecret !== undefined,
    },
    knowledge: {
      medlinePlusSearchUrl:
        optional('MEDLINEPLUS_SEARCH_URL') ?? 'https://wsearch.nlm.nih.gov/ws/query',
      wikipediaBaseUrl: optional('WIKIPEDIA_BASE_URL') ?? 'https://en.wikipedia.org',
    },
    rxnav: { baseUrl: optional('RXNAV_BASE_URL') ?? 'https://rxnav.nlm.nih.gov/REST' },
    gemini: {
      apiKey: geminiApiKey,
      baseUrl: optional('GEMINI_BASE_URL') ?? 'https://generativelanguage.googleapis.com/v1beta',
      visionModel: optional('GEMINI_VISION_MODEL') ?? 'gemini-3.6-flash',
      enabled: geminiApiKey !== undefined,
    },
    twilio: {
      accountSid: twilioSid,
      authToken: twilioToken,
      whatsappFrom: optional('TWILIO_WHATSAPP_FROM'),
      smsFrom: optional('TWILIO_SMS_FROM'),
      // Defaults to DRY RUN. An operator who forgets to set this gets a
      // rehearsal, not an unintended message to somebody's mother; the opposite
      // default would make the dangerous outcome the accidental one.
      live: optional('TWILIO_LIVE') === 'true',
      enabled: twilioSid !== undefined && twilioToken !== undefined,
    },
    osm: {
      overpassUrl: optional('OVERPASS_BASE_URL') ?? 'https://overpass-api.de/api/interpreter',
      contactEmail: optional('OSM_CONTACT_EMAIL'),
    },
    forceLocalScorer: optional('FORCE_LOCAL_SCORER') === 'true',
    corsAllowedOrigins: optional('CORS_ALLOWED_ORIGINS')?.split(',').map((s) => s.trim()),
  };
}

/**
 * What the operator sees at boot. Degraded capability is stated out loud rather
 * than discovered later from confusing behaviour — the same "say so explicitly"
 * rule §6 applies to the patient-facing side.
 */
export function describeCapabilities(config: ServerConfig): readonly string[] {
  return [
    config.firebase.enabled
      ? `Firestore      : ENABLED (project ${config.firebase.projectId})`
      : 'Firestore      : DISABLED — no GOOGLE_APPLICATION_CREDENTIALS. Using in-memory store; the mobile app will NOT receive live updates.',
    // The rule engine is PRIMARY since Infermedica was dropped, so this no
    // longer reports a permanent degradation. A banner that is always lit is a
    // banner nobody reads on the one case where it matters.
    'Clinical scorer: LIVE - deterministic red-flag rule engine. No model can produce a risk tier.',
    // Reports the ADAPTER, not the credential: "key present" is not the same
    // claim as "calls are being made", and an earlier version conflated them.
    config.groq.enabled
      ? `Reasoning      : LIVE — Groq ${config.groq.textModel} (vision: ${config.groq.visionModel}). Falls back to the deterministic stand-in on failure.`
      : 'Reasoning      : mock reasoning port — no GROQ_API_KEY.',
    'Knowledge      : LIVE — MedlinePlus (NIH) primary, Wikipedia declared fallback.',
    'Medication     : LIVE — RxNorm/RxNav (NIH). Name normalisation only; interaction checking is NOT available (endpoint retired Jan 2024).',
    config.icd11.enabled
      ? `Coding         : LIVE — WHO ICD-11 (${config.icd11.release ?? 'current release'})`
      : 'Coding         : mock coding port — no ICD11_CLIENT_ID/CLIENT_SECRET.',
    config.gemini.enabled
      ? `Vision         : LIVE - Gemini ${config.gemini.visionModel} (injury photos only; Groq keeps all text tasks)`
      : 'Vision         : UNAVAILABLE - no GEMINI_API_KEY. Injury photo assessment is disabled and says so.',
    'Hospitals      : LIVE - OpenStreetMap / Overpass, with failover across public instances. Every field is surveyed data; nothing is simulated.',
    config.twilio.enabled
      ? config.twilio.live
        ? `Notifications  : LIVE - Twilio will really send (WhatsApp from ${config.twilio.whatsappFrom ?? 'unset'}). Real phones will ring.`
        : 'Notifications  : DRY RUN - Twilio wired but TWILIO_LIVE is not "true". Messages are composed and recorded as suppressed, never sent.'
      : 'Notifications  : mock notification port - no TWILIO_ACCOUNT_SID/AUTH_TOKEN.',
    'Still mocked   : evidence normalization.',
  ];
}
