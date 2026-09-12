/**
 * Express bootstrap.
 *
 * Prints its actual capabilities at boot rather than pretending to be fully
 * wired — the same "state degradation out loud" rule §6 applies to patients
 * applies to whoever is running the demo. If Firestore or the clinical scorer
 * is missing, it says so before the first request arrives, not after a
 * confusing hour.
 */

import { createApp } from './app.js';
import { describeCapabilities, loadConfig } from './config.js';
import { buildServerTools } from './tools/build-server-tools.js';

const config = loadConfig();
const { tools, firestoreEnabled } = buildServerTools(config);
const app = createApp({ tools, config, firestoreEnabled });

app.listen(config.port, () => {
  console.log(`\n  Adaptive Emergency Triage Agent — orchestrator`);
  console.log(`  http://localhost:${config.port}\n`);
  for (const line of describeCapabilities(config)) console.log(`  ${line}`);
  console.log('');
});
