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
import { CompanionScheduler } from './companion/scheduler.js';
import { describeCapabilities, loadConfig } from './config.js';
import { buildServerTools } from './tools/build-server-tools.js';

const config = loadConfig();
const { tools, firestoreEnabled } = buildServerTools(config);
const app = createApp({ tools, config, firestoreEnabled });

/**
 * Companion Mode (§5.4) runs here, in this process, rather than as a cron job
 * or a Cloud Function. Both of those are the right answer for a real
 * deployment and both are the wrong answer for this one: the free Firebase
 * plan has no scheduled functions, and a judge watching a case keep
 * reassessing itself needs it to be visibly the SAME process that ran the
 * interview, not an invisible piece of infrastructure they have to take on
 * trust.
 */
const companion = new CompanionScheduler(tools);

app.listen(config.port, () => {
  companion.start();
  console.log(`\n  Adaptive Emergency Triage Agent — orchestrator`);
  console.log(`  http://localhost:${config.port}\n`);
  for (const line of describeCapabilities(config)) console.log(`  ${line}`);
  console.log(
    companion.supported
      // "ARMED", not "ACTIVE". At this point nothing has swept yet, and the
      // realistic failure - a missing Firestore composite index - is only
      // discoverable on the first attempt. Claiming ACTIVE here and then
      // printing COMPANION MODE IS NOT RUNNING thirty seconds later is exactly
      // the kind of contradiction that makes an operator stop reading banners.
      ? '  Companion mode : ARMED - confirmed cases reassess on their own interval (§5.4). The first sweep reports any problem.'
      : '  Companion mode : DISABLED - this store cannot list due cases.',
  );
  console.log('');
});

// Stop the sweep before the process goes away, so a tick cannot be cut off
// mid-write and leave a case at a revision nobody finished writing.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    companion.stop();
    process.exit(0);
  });
}
