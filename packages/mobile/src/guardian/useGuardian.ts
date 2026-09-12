/**
 * Drives Guardian Mode from a React screen.
 *
 * The decision logic lives in `guardianMode.ts` and is pure; this hook only
 * supplies it with a clock tick and the current case, then reports whether the
 * alarm should fire. Keeping the two apart means the "when does this go off"
 * question has one readable answer instead of being spread across effects.
 *
 * WHAT COUNTS AS A SIGN OF LIFE: any interaction at all, not just answering a
 * question. Someone scrolling the first-aid steps, or re-reading the agent's
 * last message, is plainly conscious. Requiring an ANSWER specifically would
 * fire the alarm on people who are doing exactly what the app told them to do.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RiskTier } from '@triage/shared';
import { evaluateGuardian, guardianReason } from './guardianMode';

/** One second. The countdown display is in seconds, so finer is wasted work. */
const TICK_MS = 1000;

export interface GuardianHook {
  /** Call from any user interaction to reset the silence timer. */
  readonly noteInteraction: () => void;
  /** True once the silence threshold for the current tier is crossed. */
  readonly shouldAlarm: boolean;
  /** Sentence for the countdown screen, explaining what was noticed. */
  readonly reason: string;
  /** Seconds until the alarm; undefined when not armed. */
  readonly remainingSeconds: number | undefined;
  readonly armed: boolean;
  /** Stops this case from alarming again after the user says they are fine. */
  readonly dismiss: () => void;
}

export function useGuardian(input: {
  readonly status: string | undefined;
  readonly tier: RiskTier;
  readonly enabled: boolean;
}): GuardianHook {
  const [lastInteractionAtMs, setLastInteractionAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const id = setInterval(() => {
      if (mounted.current) setNowMs(Date.now());
    }, TICK_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  const noteInteraction = useCallback(() => {
    setLastInteractionAtMs(Date.now());
    // A user who interacts after being asked "are you there?" has answered it.
    setDismissed(false);
  }, []);

  const verdict = evaluateGuardian({
    status: input.status ?? 'interviewing',
    tier: input.tier,
    lastInteractionAtMs,
    nowMs,
    enabled: input.enabled && !dismissed,
  });

  return {
    noteInteraction,
    shouldAlarm: verdict.shouldAlarm,
    reason: guardianReason(verdict, input.tier),
    remainingSeconds: verdict.armed ? Math.ceil(verdict.remainingMs / 1000) : undefined,
    armed: verdict.armed,
    dismiss: useCallback(() => {
      setDismissed(true);
      setLastInteractionAtMs(Date.now());
    }, []),
  };
}
