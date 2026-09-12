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
    readonly textModel: string;
    readonly visionModel: string;
  };
  readonly infermedica: {
    readonly appId: string | undefined;
    readonly appKey: string | undefined;
    readonly baseUrl: string;
    readonly enabled: boolean;
  };
  /** Force the local deterministic scorer even when Infermedica is configured. */
  readonly forceLocalScorer: boolean;
}

export function loadConfig(): ServerConfig {
  const credentialsPath = optional('GOOGLE_APPLICATION_CREDENTIALS');
  const projectId = optional('FIREBASE_PROJECT_ID');
  const infermedicaAppId = optional('INFERMEDICA_APP_ID');
  const infermedicaAppKey = optional('INFERMEDICA_APP_KEY');

  return {
    port: Number(optional('PORT') ?? 8787),
    nodeEnv: optional('NODE_ENV') ?? 'development',
    firebase: {
      credentialsPath,
      projectId,
      enabled: credentialsPath !== undefined && projectId !== undefined,
    },
    groq: {
      apiKey: optional('GROQ_API_KEY'),
      textModel: optional('GROQ_MODEL_TEXT') ?? 'llama-3.3-70b-versatile',
      visionModel: optional('GROQ_MODEL_VISION') ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
    },
    infermedica: {
      appId: infermedicaAppId,
      appKey: infermedicaAppKey,
      baseUrl: optional('INFERMEDICA_BASE_URL') ?? 'https://api.infermedica.com/v3',
      enabled: infermedicaAppId !== undefined && infermedicaAppKey !== undefined,
    },
    forceLocalScorer: optional('FORCE_LOCAL_SCORER') === 'true',
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
    config.infermedica.enabled && !config.forceLocalScorer
      ? 'Clinical scorer: Infermedica /triage (live)'
      : `Clinical scorer: LOCAL FALLBACK${config.forceLocalScorer ? ' (forced)' : ' — no INFERMEDICA_APP_ID/APP_KEY'}. Risk tiers carry a degradation notice.`,
    config.groq.apiKey !== undefined
      ? `Reasoning      : Groq configured (${config.groq.textModel})`
      : 'Reasoning      : mock reasoning port — no GROQ_API_KEY.',
  ];
}
