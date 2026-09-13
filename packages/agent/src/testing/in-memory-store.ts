/**
 * `CaseStorePort` backed by plain Maps. Enforces the same revision check a
 * real Firestore-backed implementation must: `update` throws
 * `RevisionConflictError` when `expectedRevision` does not match what is
 * stored, which is what lets `run-turn.test.ts` exercise the retry path
 * without standing up an emulator.
 */

import type {
  CaseId,
  CaseState,
  IsoTimestamp,
  TimelineEntry,
  ToolCallRecord,
  TurnId,
} from '@triage/shared';
import { RevisionConflictError, type CaseStorePort } from '@triage/shared';

export class InMemoryCaseStore implements CaseStorePort {
  private readonly cases = new Map<CaseId, CaseState>();
  private readonly timelines = new Map<CaseId, TimelineEntry[]>();
  private readonly toolCallLog = new Map<CaseId, ToolCallRecord[]>();
  private readonly turns = new Map<CaseId, Map<TurnId, unknown>>();

  async create(state: CaseState): Promise<void> {
    if (this.cases.has(state.caseId)) {
      throw new Error(`Case ${state.caseId} already exists.`);
    }
    this.cases.set(state.caseId, state);
    this.timelines.set(state.caseId, []);
    this.toolCallLog.set(state.caseId, []);
    this.turns.set(state.caseId, new Map());
  }

  async get(caseId: CaseId): Promise<CaseState | undefined> {
    return this.cases.get(caseId);
  }

  async update(caseId: CaseId, expectedRevision: number, next: CaseState): Promise<void> {
    const current = this.cases.get(caseId);
    if (current === undefined) throw new Error(`Case ${caseId} does not exist.`);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(caseId, expectedRevision, current.revision);
    }
    this.cases.set(caseId, next);
  }

  async appendTimeline(caseId: CaseId, entries: readonly TimelineEntry[]): Promise<void> {
    const list = this.timelines.get(caseId) ?? [];
    this.timelines.set(caseId, [...list, ...entries]);
  }

  async appendToolCall(caseId: CaseId, record: ToolCallRecord): Promise<void> {
    const list = this.toolCallLog.get(caseId) ?? [];
    this.toolCallLog.set(caseId, [...list, record]);
  }

  async saveTurn(caseId: CaseId, turnId: TurnId, turn: unknown): Promise<void> {
    const map = this.turns.get(caseId) ?? new Map<TurnId, unknown>();
    map.set(turnId, turn);
    this.turns.set(caseId, map);
  }

  async listTimeline(caseId: CaseId): Promise<readonly TimelineEntry[]> {
    return this.timelines.get(caseId) ?? [];
  }

  async listToolCalls(caseId: CaseId): Promise<readonly ToolCallRecord[]> {
    return this.toolCallLog.get(caseId) ?? [];
  }

  /**
   * The same due-queue the Firestore store answers with an index, done here by
   * scanning. Present so the Companion Mode scheduler can be exercised end to
   * end with no Firebase credential at all - without it, the one feature whose
   * whole point is "the agent keeps working when nobody is looking" would be
   * untestable in CI.
   */
  async listDueCompanionCases(now: IsoTimestamp, limit: number): Promise<readonly CaseState[]> {
    return [...this.cases.values()]
      .filter(
        (c) =>
          c.companion.active &&
          (c.status === 'action_taken' || c.status === 'interviewing') &&
          (c.companion.nextReassessmentDueAt === undefined ||
            c.companion.nextReassessmentDueAt <= now),
      )
      .sort((a, b) =>
        (a.companion.nextReassessmentDueAt ?? '').localeCompare(
          b.companion.nextReassessmentDueAt ?? '',
        ),
      )
      .slice(0, limit);
  }

  /** Test-only convenience — bypasses the revision check for initial setup. */
  seed(state: CaseState): void {
    this.cases.set(state.caseId, state);
    this.timelines.set(state.caseId, []);
    this.toolCallLog.set(state.caseId, []);
    this.turns.set(state.caseId, new Map());
  }
}
