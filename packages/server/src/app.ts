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

export interface AppDeps {
  readonly tools: AgentTools;
  readonly config: ServerConfig;
  readonly firestoreEnabled: boolean;
}

export function createApp({ tools, config, firestoreEnabled }: AppDeps): Express {
  const app = express();

  // The Expo dev client connects from an arbitrary LAN origin, so development
  // accepts any origin. Tighten to an allow-list before this is ever public.
  app.use(cors({ origin: config.nodeEnv === 'production' ? false : true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      firestoreEnabled,
      clinicalScorer:
        config.infermedica.enabled && !config.forceLocalScorer ? 'infermedica' : 'local_fallback',
    });
  });

  app.use('/cases', createCaseRoutes(tools));
  app.use('/medications', createMedicationRoutes(tools));
  app.use(errorHandler);

  return app;
}
