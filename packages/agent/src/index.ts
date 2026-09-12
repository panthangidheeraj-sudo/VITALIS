/**
 * @triage/agent — the Observe-Decide-Act-Evaluate-Adapt orchestration loop.
 *
 * Depends only on @triage/shared's tool ports. packages/server wires real
 * adapters (Groq, Infermedica, Twilio, Firestore) behind those same
 * interfaces; nothing in this package changes when that happens.
 */

export * from './loop/orchestrator.js';
export * from './loop/run-turn.js';
export * from './loop/confirm-routing.js';
export * from './loop/companion-reassessment.js';
export * from './loop/ledger.js';

export * from './evidence/apply-evidence.js';
export * from './confidence/confidence-policy.js';
export * from './contradiction/resolve.js';
export * from './scoring/local-deterministic-scorer.js';
export * from './scoring/rules.js';
export * from './quick-select.js';

export * from './testing/manual-clock.js';
export * from './testing/sequential-id-port.js';
export * from './testing/in-memory-store.js';
export * from './testing/mock-normalization-port.js';
export * from './testing/mock-reasoning-port.js';
export * from './testing/mock-support-ports.js';
export * from './testing/build-tools.js';
