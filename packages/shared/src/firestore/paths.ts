/**
 * Firestore layout — the single source of truth for every collection path.
 *
 * Hardcoded path strings scattered across a codebase are how a frontend
 * listener quietly ends up watching a collection nothing writes to. Every read
 * and write, on both the server and the PWA, goes through these helpers.
 *
 * WHY SUBCOLLECTIONS RATHER THAN ARRAYS ON THE CASE DOCUMENT:
 *   - Firestore caps a document at 1 MiB. A Companion Mode case reassessing
 *     every 2–5 minutes for an hour, with a tool-call ledger, would approach it.
 *   - Writes to one document serialise. Companion Mode ticking while a caregiver
 *     answers a question is a realistic collision, and losing a symptom to a
 *     lost update is not an acceptable failure mode here.
 *   - The PWA can subscribe to the timeline alone without re-downloading the
 *     whole case on every tool call.
 *
 * The case document itself stays small and is the one thing the UI listens to
 * for risk/confidence/status changes.
 */

import type { CaseId, PatientId, TimelineEntryId, ToolCallId, TurnId } from '../types/common.js';

export const COLLECTIONS = {
  cases: 'cases',
  patients: 'patients',
  hospitals: 'hospitals',
} as const;

export const SUBCOLLECTIONS = {
  turns: 'turns',
  timeline: 'timeline',
  toolCalls: 'toolCalls',
} as const;

// --- Case ---------------------------------------------------------------------

/** `cases/{caseId}` — the CaseState document. Small, and listened to live. */
export const casePath = (caseId: CaseId): string => `${COLLECTIONS.cases}/${caseId}`;

/** `cases/{caseId}/turns` — one document per loop iteration. */
export const turnsPath = (caseId: CaseId): string =>
  `${casePath(caseId)}/${SUBCOLLECTIONS.turns}`;
export const turnPath = (caseId: CaseId, turnId: TurnId): string =>
  `${turnsPath(caseId)}/${turnId}`;

/** `cases/{caseId}/timeline` — append-only, ordered by `at`. */
export const timelinePath = (caseId: CaseId): string =>
  `${casePath(caseId)}/${SUBCOLLECTIONS.timeline}`;
export const timelineEntryPath = (caseId: CaseId, entryId: TimelineEntryId): string =>
  `${timelinePath(caseId)}/${entryId}`;

/**
 * `cases/{caseId}/toolCalls` — the ledger. Rendered in the UI as live proof
 * that external tools are genuinely being called.
 */
export const toolCallsPath = (caseId: CaseId): string =>
  `${casePath(caseId)}/${SUBCOLLECTIONS.toolCalls}`;
export const toolCallPath = (caseId: CaseId, callId: ToolCallId): string =>
  `${toolCallsPath(caseId)}/${callId}`;

// --- Patient & hospital -------------------------------------------------------

/** `patients/{patientId}` — profile and One-Tap Emergency Card. */
export const patientPath = (patientId: PatientId): string =>
  `${COLLECTIONS.patients}/${patientId}`;

/**
 * `hospitals/{osmId}` — cached hospital records, keyed by OpenStreetMap
 * element id.
 * OSM ids contain a slash (`node/123`), which is illegal in a Firestore
 * document id, so they are encoded.
 */
export const hospitalPath = (osmId: string): string =>
  `${COLLECTIONS.hospitals}/${encodeOsmId(osmId)}`;

export const encodeOsmId = (osmId: string): string => osmId.replace(/\//g, '_');
export const decodeOsmId = (docId: string): string => docId.replace(/_/g, '/');

// --- Index requirements -------------------------------------------------------

/**
 * Composite indexes the queries below need. Kept next to the paths so
 * `firestore.indexes.json` and the code cannot drift apart.
 */
export const REQUIRED_INDEXES = [
  {
    collectionGroup: SUBCOLLECTIONS.timeline,
    description: 'Timeline rendered chronologically for the live view and handoff card.',
    fields: [{ fieldPath: 'at', order: 'ASCENDING' }],
  },
  {
    collectionGroup: SUBCOLLECTIONS.toolCalls,
    description: 'Tool-call ledger, newest first.',
    fields: [{ fieldPath: 'startedAt', order: 'DESCENDING' }],
  },
  {
    collectionGroup: SUBCOLLECTIONS.turns,
    description: 'Turns in loop order.',
    fields: [{ fieldPath: 'index', order: 'ASCENDING' }],
  },
  {
    collectionGroup: COLLECTIONS.cases,
    description:
      "Companion Mode's due queue (§5.4). The scheduler asks for active cases whose " +
      'reassessment time has passed; an equality plus a range needs a composite index, ' +
      'and without it the query fails at runtime rather than at deploy time.',
    fields: [
      { fieldPath: 'companion.active', order: 'ASCENDING' },
      { fieldPath: 'companion.nextReassessmentDueAt', order: 'ASCENDING' },
    ],
  },
] as const;

// --- Listener targets ---------------------------------------------------------

/**
 * What the PWA subscribes to. §3.1 chose Firestore real-time listeners over a
 * WebSocket layer; these are the three streams that produce the live-updating
 * risk tier, appending timeline, and visible tool ledger.
 */
export function liveListenerTargets(caseId: CaseId): {
  readonly caseDoc: string;
  readonly timeline: string;
  readonly toolCalls: string;
} {
  return {
    caseDoc: casePath(caseId),
    timeline: timelinePath(caseId),
    toolCalls: toolCallsPath(caseId),
  };
}
