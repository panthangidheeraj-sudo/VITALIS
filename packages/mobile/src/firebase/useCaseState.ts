/**
 * The live case subscription - spec 3.1's "Firestore real-time listeners
 * rather than a separate WebSocket layer".
 *
 * This hook is what makes the demo's central moment work: the phone is not
 * polling and not re-fetching after a submit. The server writes a new risk tier
 * to Firestore and the tier on screen changes, unprompted, because
 * `onSnapshot` pushed it. Three streams are watched, exactly the three that
 * `liveListenerTargets()` in @triage/shared already names, so the client and
 * server cannot drift on which collections matter.
 *
 * Incoming documents are validated through `parseCaseState` before they reach
 * UI state. Firestore is a trust boundary like any other - a document written
 * by an older build, or hand-edited in the console mid-demo, should surface as
 * a visible error rather than crash a screen or render half-applied state.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';
import type { CaseId, CaseState, TimelineEntry, ToolCallRecord } from '@triage/shared';
import { liveListenerTargets, parseCaseState } from '@triage/shared';
import { getDb } from './client';

export interface LiveCase {
  readonly caseState: CaseState | undefined;
  readonly timeline: readonly TimelineEntry[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly connected: boolean;
  readonly error: string | undefined;
}

const EMPTY: LiveCase = {
  caseState: undefined,
  timeline: [],
  toolCalls: [],
  connected: false,
  error: undefined,
};

export function useCaseState(caseId: CaseId | undefined): LiveCase {
  const [state, setState] = useState<LiveCase>(EMPTY);

  // Path strings come from the shared helper, so a change to the Firestore
  // layout updates the server and the app together.
  const targets = useMemo(
    () => (caseId === undefined ? undefined : liveListenerTargets(caseId)),
    [caseId],
  );

  useEffect(() => {
    if (targets === undefined) {
      setState(EMPTY);
      return;
    }

    const db = getDb();
    const subscriptions: Unsubscribe[] = [];

    subscriptions.push(
      onSnapshot(
        doc(db, targets.caseDoc),
        (snapshot) => {
          if (!snapshot.exists()) {
            setState((prev) => ({ ...prev, connected: true, caseState: undefined }));
            return;
          }
          const parsed = parseCaseState(snapshot.data());
          if (!parsed.ok) {
            setState((prev) => ({
              ...prev,
              connected: true,
              error: `Case document failed validation: ${parsed.issues.slice(0, 2).join('; ')}`,
            }));
            return;
          }
          setState((prev) => ({
            ...prev,
            connected: true,
            error: undefined,
            caseState: parsed.value as unknown as CaseState,
          }));
        },
        (err) => setState((prev) => ({ ...prev, connected: false, error: err.message })),
      ),
    );

    subscriptions.push(
      onSnapshot(
        query(collection(db, targets.timeline), orderBy('at')),
        (snapshot) => {
          const entries = snapshot.docs.map((d) => d.data() as TimelineEntry);
          setState((prev) => ({ ...prev, timeline: entries }));
        },
        (err) => setState((prev) => ({ ...prev, error: err.message })),
      ),
    );

    subscriptions.push(
      onSnapshot(
        query(collection(db, targets.toolCalls), orderBy('startedAt', 'desc')),
        (snapshot) => {
          const calls = snapshot.docs.map((d) => d.data() as ToolCallRecord);
          setState((prev) => ({ ...prev, toolCalls: calls }));
        },
        // The ledger is diagnostic; losing it must not take down the screen
        // showing someone their risk level.
        () => undefined,
      ),
    );

    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [targets]);

  return state;
}
