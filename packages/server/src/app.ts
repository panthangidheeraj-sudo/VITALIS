/**
 * Express app construction, separated from `listen` so tests can build the
 * real app — same routes, same middleware, same error mapping — and drive it
 * over HTTP on an ephemeral port without booting the process.
 */

import cors from 'cors';
import express, { type Express } from 'express';
import type { AgentTools } from '@triage/shared';
import type { ServerConfig } from './config.js';
import { createCaseRoutes, errorHandler } from './routes/cases.js';
import { createMedicationRoutes } from './routes/medications.js';
import { createHospitalRoutes } from './routes/hospitals.js';
import { createAssistantRoutes } from './routes/assistant.js';
import { GroqChatPort } from './adapters/groq-chat-port.js';

export interface AppDeps {
  readonly tools: AgentTools;
  readonly config: ServerConfig;
  readonly firestoreEnabled: boolean;
}

export function createApp({ tools, config, firestoreEnabled }: AppDeps): Express {
  const app = express();

  // Separate from `tools.reasoning` (GroqReasoningPort) deliberately — see
  // adapters/groq-chat-port.ts's header for why a free-conversation call
  // does not belong on the triage-scoped `ReasoningPort` interface.
  const chatPort = config.groq.enabled
    ? new GroqChatPort({
        apiKeys: config.groq.apiKeys,
        baseUrl: config.groq.baseUrl,
        textModel: config.groq.textModel,
      })
    : undefined;

  // Expo Go's fetch is not a browser and ignores CORS entirely — this only
  // ever matters for a browser-based client (a future web dashboard, or
  // just testing the API from a browser devtools console). Previously this
  // was `origin: false` in production, which silently blocks every such
  // client with no indication why; now it defaults to allowing any origin,
  // same as development, unless CORS_ALLOWED_ORIGINS names a specific list
  // to restrict to.
  app.use(
    cors({
      origin: config.corsAllowedOrigins === undefined ? true : [...config.corsAllowedOrigins],
    }),
  );
  // '1mb' was too small for a base64-encoded photo (injury photos and now
  // medicine-pack photos both go through this same JSON body) - a real
  // phone photo, even compressed, routinely exceeds that once base64's
  // ~33% overhead is added, and the previous limit would have silently
  // rejected exactly the uploads these features exist for.
  app.use(express.json({ limit: '10mb' }));

  /**
   * Capability report, not just a liveness ping.
   *
   * The mobile app reads this to decide what to TELL THE USER is available —
   * the injury-photo screen says "no vision model is enabled" or "photo reading
   * is available" based on `visionEnabled`. Hardcoding that on the client is
   * how a screen ends up claiming a working feature is broken, which trains
   * people to ignore the message when it is real.
   */
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      firestoreEnabled,
      clinicalScorer:
        config.infermedica.enabled && !config.forceLocalScorer ? 'infermedica' : 'local_rules',
      visionEnabled: config.gemini.enabled,
      reasoningEnabled: config.groq.enabled,
      generalChatEnabled: chatPort !== undefined,
      // `enabled` is having credentials; `live` is being willing to use them.
      // The app needs the second one — a dry-run send is not a send.
      notificationsLive: config.twilio.enabled && config.twilio.live,
    });
  });

  // One construction of the vision config, shared by every route that needs
  // it — `undefined` when GEMINI_API_KEY is absent, which each route reports
  // honestly rather than failing as if it were a bug.
  const geminiConfig = config.gemini.enabled
    ? {
        apiKey: config.gemini.apiKey as string,
        baseUrl: config.gemini.baseUrl,
        visionModel: config.gemini.visionModel,
      }
    : undefined;

  app.use('/cases', createCaseRoutes(tools));
  app.use('/medications', createMedicationRoutes(tools, geminiConfig));
  app.use('/hospitals', createHospitalRoutes(tools));
  app.use('/assistant', createAssistantRoutes(chatPort, tools.knowledge, tools.medication, geminiConfig));
  app.use(errorHandler);

  return app;
}
