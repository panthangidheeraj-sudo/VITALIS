/**
 * @triage/shared — the contract layer.
 *
 * `packages/agent`, `packages/server` and `packages/web` all depend on this and
 * on nothing else of each other's. Every type the case passes through, every
 * external tool interface, the deterministic routing policy, the Firestore
 * layout and the runtime validators live here.
 */

// --- Types -------------------------------------------------------------------
export * from './types/common.js';
export * from './types/evidence.js';
export * from './types/risk.js';
export * from './types/confidence.js';
export * from './types/communication.js';
export * from './types/turn.js';
export * from './types/routing.js';
export * from './types/timeline.js';
export * from './types/patient.js';
export * from './types/hospital.js';
export * from './types/notification.js';
export * from './types/tool-call.js';
export * from './types/handoff.js';
export * from './types/case-state.js';

// --- Tool ports --------------------------------------------------------------
export * from './tools/result.js';
export * from './tools/ports.js';

// --- Policy ------------------------------------------------------------------
export * from './policy/risk-policy.js';

// --- Geo ---------------------------------------------------------------------
export * from './geo/distance.js';

// --- Firestore ---------------------------------------------------------------
export * from './firestore/paths.js';

// --- Schemas -----------------------------------------------------------------
export * from './schemas/primitives.js';
export * from './schemas/case.js';
export * from './schemas/groq-outputs.js';
