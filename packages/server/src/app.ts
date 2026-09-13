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
        apiKey: config.groq.apiKey as string,
        baseUrl: config.groq.baseUrl,
        textModel: config.groq.textModel,
      })
    : undefined;

  // The Expo dev client connects from an arbitrary LAN origin, so development
  // accepts any origin. Tighten to an allow-list before this is ever public.
  app.use(cors({ origin: config.nodeEnv === 'production' ? false : true }));
  app.use(express.json({ limit: '1mb' }));

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

  app.use('/cases', createCaseRoutes(tools));
  app.use('/medications', createMedicationRoutes(tools));
  app.use('/hospitals', createHospitalRoutes(tools));
  app.use('/assistant', createAssistantRoutes(chatPort, tools.knowledge));
  app.use(errorHandler);

  return app;
}
