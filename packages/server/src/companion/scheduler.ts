/**
 * The Companion Mode scheduler (spec 5.4) - the thing that makes this an agent
 * that keeps working when nobody is looking at it.
 *
 * `runCompanionTick` has existed since the loop was written and, until this
 * file, nothing ever called it: no case ever had `companion.active === true`
 * and no timer ever fired. The capability was real and unreachable, which from
 * the outside is indistinguishable from not having it. This is the missing
 * half.
 *
 * ---------------------------------------------------------------------------
 * DESIGN NOTES, EACH OF WHICH IS A BUG THAT WOULD OTHERWISE HAPPEN
 *
 * 1. SERIAL, NOT PARALLEL. Ticks run one case at a time. A tick calls Groq and
 *    the scorer; ten cases ticking at once on a free-tier key means rate
 *    limiting, and a rate-limited reassessment is a degraded banner on a live
 *    emergency. Latency does not matter here - nobody is waiting on a 3-minute
 *    background check.
 *
 * 2. A REVISION CONFLICT IS NORMAL AND IS NOT AN ERROR. The patient answering a
 *    question at the same moment a tick runs is exactly the race the revision
 *    counter exists for, and the patient's write must win: theirs carries new
 *    information, the tick carries none. So a conflict is swallowed with a
 *    debug line, not retried - retrying would re-apply a reassessment on top of
 *    state that has already moved past it.
 *
 * 3. NO OVERLAPPING SWEEPS. `setInterval` does not wait for an async callback,
 *    so a slow sweep would be re-entered and tick the same case twice. The
 *    `running` guard prevents that; a skipped sweep is harmless because the due
 *    queue is computed fresh each time.
 *
 * 4. THE ERROR PATH CANNOT KILL THE PROCESS. An unhandled rejection inside a
 *    timer callback terminates Node. An orchestrator that dies three minutes
 *    after a successful dispatch, from a background task nobody can see, is the
 *    worst possible failure in this system - so every tick is individually
 *    caught.
 * ---------------------------------------------------------------------------
 */

import type { AgentTools, CaseState } from '@triage/shared';
import { RevisionConflictError } from '@triage/shared';
import { runCompanionTick } from '@triage/agent';

export interface CompanionSchedulerOptions {
  /**
   * How often to LOOK for due cases - not how often a case is reassessed. That
   * interval belongs to the case (`companion.intervalMs`, 2-5 minutes per
   * 5.4). Sweeping more often than the shortest case interval just means due
   * cases are picked up promptly rather than up to a full sweep late.
   */
  readonly sweepIntervalMs: number;
  /** Cap per sweep, so one backlog cannot monopolise the free-tier quota. */
  readonly batchSize: number;
}

export const DEFAULT_SCHEDULER_OPTIONS: CompanionSchedulerOptions = {
  sweepIntervalMs: 30_000,
  batchSize: 10,
};

export class CompanionScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly tools: AgentTools,
    private readonly options: CompanionSchedulerOptions = DEFAULT_SCHEDULER_OPTIONS,
  ) {}

  /** True when the store can answer the due-case query at all. */
  get supported(): boolean {
    return typeof this.tools.store.listDueCompanionCases === 'function';
  }

  start(): void {
    if (this.timer !== undefined) return;
    if (!this.supported) {
      // Stated out loud rather than silently doing nothing for the rest of the
      // process's life. Same rule as 6: a capability that is off has to say so.
      console.warn(
        '[companion] store cannot list due cases — Companion Mode reassessment is DISABLED.',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.options.sweepIntervalMs);
    // Do not hold the event loop open on this timer alone; a server whose only
    // remaining work is an empty sweep should still be able to exit.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Exposed so tests can drive a sweep deterministically instead of waiting. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    const list = this.tools.store.listDueCompanionCases;
    if (list === undefined) return 0;

    this.running = true;
    let ticked = 0;
    try {
      const due = await list.call(
        this.tools.store,
        this.tools.clock.now(),
        this.options.batchSize,
      );
      for (const state of due) {
        if (await this.tick(state)) ticked += 1;
      }
    } catch (err) {
      this.reportSweepFailure(err);
    } finally {
      this.running = false;
    }
    return ticked;
  }

  /**
   * Reports a sweep failure ONCE per distinct cause, not every 30 seconds.
   *
   * The realistic failure is a missing Firestore composite index, and it does
   * not heal on its own — repeating the same stack trace twice a minute buries
   * the one line that says what to do about it. Worse, the boot banner has
   * already announced Companion Mode as ACTIVE, so a failure that scrolls past
   * leaves the operator believing reassessment is running when it never once
   * has. The index case is called out by name with the console link Firestore
   * itself supplies.
   */
  private reportSweepFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    if (message === this.lastSweepError) return;
    this.lastSweepError = message;

    if (message.includes('requires an index')) {
      const link = /https:\/\/console\.firebase\.google\.com\S+/.exec(message)?.[0];
      console.error(
        [
          '',
          '[companion] COMPANION MODE IS NOT RUNNING. Firestore needs a composite index',
          '            on companion.active + companion.nextReassessmentDueAt. It is already',
          '            declared in firebase/firestore.indexes.json, so either run:',
          '                firebase deploy --only firestore:indexes',
          '            or open the one-click link Firestore supplied:',
          `                ${link ?? '(see the error below)'}`,
          '',
        ].join('\n'),
      );
      return;
    }
    console.error('[companion] sweep failed:', err);
  }

  private lastSweepError: string | undefined;

  private async tick(state: CaseState): Promise<boolean> {
    try {
      const result = await runCompanionTick(state, this.tools);
      await this.tools.store.update(state.caseId, state.revision, {
        ...result.nextState,
        revision: state.revision + 1,
      });
      await this.tools.store.appendTimeline(state.caseId, result.timeline);
      for (const call of result.toolCalls) {
        await this.tools.store.appendToolCall(state.caseId, call);
      }
      return true;
    } catch (err) {
      if (err instanceof RevisionConflictError) {
        // See note 2 in the header. The patient wrote first; they win.
        console.debug(`[companion] ${state.caseId}: skipped, case moved on mid-tick.`);
        return false;
      }
      console.error(`[companion] ${state.caseId}: tick failed:`, err);
      return false;
    }
  }
}
