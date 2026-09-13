/**
 * `CaseStorePort` backed by Firestore (Admin SDK).
 *
 * The one subtle piece is `update`. The port's contract is optimistic
 * concurrency: the caller passes the revision it read, and the write is
 * rejected if the stored document has moved on. `InMemoryCaseStore` does that
 * with a plain comparison; here it has to be a TRANSACTION, because between a
 * read and a write another process (a Companion Mode tick, a second device on
 * the same case) can land its own write. A read-then-write without the
 * transaction would reintroduce exactly the lost-update race the revision
 * counter exists to prevent — and in this domain a lost update means a
 * reported symptom silently disappearing from the record.
 *
 * `RevisionConflictError` is thrown unchanged from @triage/shared, so
 * `runTurn`'s existing retry path works against this store without knowing
 * Firestore exists.
 *
 * Subcollections (timeline, toolCalls, turns) are append-only and never
 * contended, so they need no transaction — and keeping them out of the case
 * document is what stops a long Companion Mode case from approaching
 * Firestore's 1 MiB per-document cap.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type {
  CaseId,
  CaseState,
  CaseStorePort,
  IsoTimestamp,
  TimelineEntry,
  ToolCallRecord,
  TurnId,
} from '@triage/shared';
import {
  COLLECTIONS,
  RevisionConflictError,
  casePath,
  timelinePath,
  toolCallsPath,
  turnPath,
} from '@triage/shared';

export class FirestoreCaseStore implements CaseStorePort {
  constructor(private readonly db: Firestore) {}

  async create(state: CaseState): Promise<void> {
    // `create()` (not `set()`) so a colliding id is an error rather than a
    // silent overwrite of someone else's live emergency.
    await this.db.doc(casePath(state.caseId)).create(stripUndefined(state));
  }

  async get(caseId: CaseId): Promise<CaseState | undefined> {
    const snapshot = await this.db.doc(casePath(caseId)).get();
    return snapshot.exists ? (snapshot.data() as CaseState) : undefined;
  }

  async update(caseId: CaseId, expectedRevision: number, next: CaseState): Promise<void> {
    const ref = this.db.doc(casePath(caseId));
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        throw new Error(`Case ${caseId} does not exist.`);
      }
      const current = snapshot.data() as CaseState;
      if (current.revision !== expectedRevision) {
        throw new RevisionConflictError(caseId, expectedRevision, current.revision);
      }
      tx.set(ref, stripUndefined(next));
    });
  }

  async appendTimeline(caseId: CaseId, entries: readonly TimelineEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const batch = this.db.batch();
    for (const entry of entries) {
      batch.set(this.db.collection(timelinePath(caseId)).doc(entry.id), stripUndefined(entry));
    }
    await batch.commit();
  }

  async appendToolCall(caseId: CaseId, record: ToolCallRecord): Promise<void> {
    await this.db.collection(toolCallsPath(caseId)).doc(record.id).set(stripUndefined(record));
  }

  async saveTurn(caseId: CaseId, turnId: TurnId, turn: unknown): Promise<void> {
    // The port types `turn` as `unknown` deliberately — the store persists a
    // Turn without needing to know its shape. Firestore needs an object, so
    // that is the one thing asserted here.
    await this.db
      .doc(turnPath(caseId, turnId))
      .set(stripUndefined(turn) as Record<string, unknown>);
  }

  async listTimeline(caseId: CaseId): Promise<readonly TimelineEntry[]> {
    const snapshot = await this.db.collection(timelinePath(caseId)).orderBy('at').get();
    return snapshot.docs.map((d) => d.data() as TimelineEntry);
  }

  async listToolCalls(caseId: CaseId): Promise<readonly ToolCallRecord[]> {
    const snapshot = await this.db
      .collection(toolCallsPath(caseId))
      .orderBy('startedAt', 'desc')
      .get();
    return snapshot.docs.map((d) => d.data() as ToolCallRecord);
  }

  /**
   * Companion Mode's due queue (5.4).
   *
   * The equality on `companion.active` plus the range on
   * `companion.nextReassessmentDueAt` is a composite index requirement -
   * Firestore will refuse the query with a console link to create it the first
   * time it runs, which is why `firestore.indexes.json` declares it up front.
   *
   * `status` is filtered IN MEMORY rather than adding a third clause. An
   * inequality plus two equalities widens the index for very little benefit at
   * this scale, and getting the filter wrong in the query means a cancelled
   * case keeps being reassessed - a mistake that is much easier to see written
   * out here than buried in a chain of `.where()` calls.
   */
  async listDueCompanionCases(
    now: IsoTimestamp,
    limit: number,
  ): Promise<readonly CaseState[]> {
    const snapshot = await this.db
      .collection(COLLECTIONS.cases)
      .where('companion.active', '==', true)
      .where('companion.nextReassessmentDueAt', '<=', now)
      .orderBy('companion.nextReassessmentDueAt')
      .limit(limit)
      .get();

    return snapshot.docs
      .map((d) => d.data() as CaseState)
      .filter((c) => c.status === 'action_taken' || c.status === 'interviewing');
  }
}

/**
 * Firestore rejects `undefined` field values outright. The domain types use
 * optional properties heavily (`exactOptionalPropertyTypes` means an absent
 * key, not an explicit undefined) — but objects built by spreading can still
 * carry an undefined through. Strip them rather than configuring
 * `ignoreUndefinedProperties`, which would hide genuine mistakes everywhere
 * else in the app too.
 */
function stripUndefined<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = stripUndefined(item);
  }
  return out as T;
}
