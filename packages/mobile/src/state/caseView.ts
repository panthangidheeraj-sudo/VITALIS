/**
 * Turns live case state into the fields the design's screens read.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * The design ships a hand-written `STEPS` array: four frozen snapshots with
 * their tier, confidence sentence, question, adaptation notice and tool-call
 * ledger all written out by hand, advanced by a button. It is exactly right for
 * a design file and it must not survive into the app, because every one of
 * those values is something the running system actually computes — and a
 * screen that shows a plausible tier next to a real one is worse than a screen
 * that shows nothing.
 *
 * So this is the seam. Same field names the design used, derived from
 * `CaseState` instead of from a literal. Screens stay close to the design;
 * nothing on them is invented.
 *
 * THE LEDGER IS THE SHARPEST CASE. The design's rows read
 * `infermedica /parse`, `infermedica /triage`. This system does not call
 * Infermedica at all — the tier comes from the local deterministic rule engine.
 * Those strings now come from the real `ToolCallRecord` stream, so the panel
 * labelled "LIVE" is telling the truth about which vendor ran.
 * ---------------------------------------------------------------------------
 */

import type {
  CaseState,
  RiskTier,
  RoutingOutcome,
  TimelineEntry,
  ToolCallRecord,
} from '@triage/shared';

/*
 * NOTE: this module imports NOTHING from the presentation layer, and that is
 * load-bearing rather than tidiness. `theme.ts` imports `react-native`, whose
 * entry point is Flow-typed JavaScript that the test runner's parser cannot
 * read — so a single `import { tierColor } from '../theme'` here makes this
 * file, and every test of it, unloadable in Node. Colours and labels are looked
 * up by the screens, which are in React Native already.
 */

export interface LedgerRow {
  readonly at: string;
  readonly call: string;
  readonly ms: string;
}

export interface CaseView {
  readonly tier: RiskTier;
  /** The routing outcome, wrapped for the two-line slot in the tier header. */
  readonly outcomeLines: string;

  readonly confidenceBars: number;
  readonly confidenceLabel: string;
  readonly confidenceSentence: string;

  readonly degraded: boolean;
  readonly degradationNotice: string | undefined;

  readonly ledger: readonly LedgerRow[];
  readonly timeline: readonly { readonly at: string; readonly text: string }[];

  /** Title and subtitle above the tier card — they change as the case moves. */
  readonly title: string;
  readonly subtitle: string;
}

/** `07:04` in the device's own timezone. The design's format exactly. */
export function clockTime(iso: string | undefined): string {
  if (iso === undefined) return '--:--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Outcome text for the tier header's right-hand column.
 *
 * Hand-mapped rather than produced by replacing underscores with spaces,
 * because the header has room for two short lines and `er_self_transport`
 * would otherwise render as "er self transport" — which is not English and
 * tells a frightened person nothing.
 */
const OUTCOME_TEXT: Record<RoutingOutcome, string> = {
  self_care_guidance: 'self-care\nguidance',
  primary_care_24h: 'see a doctor\nwithin 24h',
  urgent_care_now: 'urgent care\nnow',
  er_self_transport: 'emergency room\ngo now',
  ambulance_dispatch: 'emergency\nambulance',
  // The sixth outcome. Worded as a handover, not as a failure — §1 treats it as
  // a deliberate result, and the escalation screen is built on that framing.
  escalate_human_unresolved: 'handing to\na clinician',
};

/** The same mapping as one line, for buttons and prose. */
export function outcomeSentence(outcome: RoutingOutcome): string {
  return OUTCOME_TEXT[outcome].replace('\n', ' ');
}

/**
 * What the tier implies when no routing decision has been proposed yet.
 *
 * The header must say something from the very first turn, and the honest thing
 * to say before a decision exists is what the tier means, not a decision that
 * has not been made.
 */
const TIER_PROVISIONAL: Record<RiskTier, string> = {
  green: 'assessing\nno action yet',
  yellow: 'assessing\nno action yet',
  orange: 'assessing\nno action yet',
  red: 'assessing\nno action yet',
};

/**
 * Confidence as a 0-5 bar count.
 *
 * Floored at 1 whenever a case exists: zero bars is indistinguishable from a
 * component that failed to render, and "I know nothing at all" is not a state
 * the interview can actually be in once a single answer has landed.
 */
function barsFor(score: number): number {
  return Math.max(1, Math.min(5, Math.round(score * 5)));
}

export function buildCaseView(
  state: CaseState,
  timeline: readonly TimelineEntry[],
  toolCalls: readonly ToolCallRecord[],
): CaseView {
  const tier = state.risk.tier;
  const proposed = state.routing?.outcome;

  return {
    tier,
    outcomeLines: proposed === undefined ? TIER_PROVISIONAL[tier] : OUTCOME_TEXT[proposed],

    confidenceBars: barsFor(state.confidence.score),
    confidenceLabel: state.confidence.alertActive
      ? `${state.confidence.level.toUpperCase()} · ALERT`
      : state.confidence.level.toUpperCase(),
    confidenceSentence: confidenceSentence(state),

    degraded: state.degradation.clinicalScoringDegraded,
    degradationNotice: state.degradation.notice,

    ledger: toolCalls.map((call) => ({
      at: clockTime(call.startedAt),
      // `tool` is already the vendor-qualified name the ledger records
      // (`groq.select_question`, `osm.find_hospitals`). Printing it verbatim is
      // the point — it is evidence, and paraphrasing evidence is editing it.
      call: call.argsDigest.length > 0 ? `${call.tool} · ${call.argsDigest}` : call.tool,
      // `latencyMs` is optional on the record — a call that never returned has
      // no latency. Showing "undefinedms" in a panel labelled LIVE would be a
      // small lie in exactly the place that is meant to be checkable.
      ms: call.latencyMs === undefined ? '—' : `${call.latencyMs}ms`,
    })),

    timeline: timeline.map((entry) => ({ at: clockTime(entry.at), text: entry.summary })),

    title: titleFor(state),
    subtitle: subtitleFor(state),
  };
}

/**
 * The sentence under the confidence bars.
 *
 * The design writes four of these by hand, one per scripted step, and they are
 * genuinely good writing — so these keep their voice while being selected by
 * real state rather than by a step counter. An unresolved contradiction beats
 * everything else, because it is the one the patient most needs explained: the
 * app is about to tell them it will not act yet, and "why" cannot be implied.
 */
function confidenceSentence(state: CaseState): string {
  const unresolved = state.confidence.contradictions.filter((c) => c.resolvedAt === undefined);
  if (unresolved.length > 0) {
    const first = unresolved[0]!;
    return `${first.detail} I am not calling either account wrong — I need one more answer before I act on this.`;
  }
  if (state.confidence.alertActive) {
    return 'I am not confident enough to route this yet. The next answer matters more than the last few.';
  }
  if (state.evidence.length <= 1) {
    return 'One report so far, and nothing contradicts it. A couple more answers and I can score this properly.';
  }
  if (state.confidence.level === 'low') {
    return 'Your answers are short, so I am holding some doubt. I will keep checking rather than assume.';
  }
  return 'Nothing so far contradicts anything else. I will keep re-checking as you answer.';
}

/** The headline above the tier card. */
function titleFor(state: CaseState): string {
  if (state.status === 'awaiting_confirmation' && state.routing !== undefined) {
    return state.routing.outcome === 'ambulance_dispatch'
      ? 'You need an ambulance.'
      : 'Here is what I recommend.';
  }
  if (state.status === 'escalated') return 'A human is taking over.';
  if (state.status === 'cancelled') return 'Alert cancelled.';
  if (state.risk.tier === 'red') return 'This is serious now.';
  if (state.evidence.length === 0) return 'Are you in an emergency?';
  return 'Noted. Keep going.';
}

function subtitleFor(state: CaseState): string {
  if (state.status === 'awaiting_confirmation') return 'Hold the dial. I will not dial on a tap.';
  if (state.evidence.length === 0) {
    return 'Tell me what is happening. I ask one thing at a time.';
  }
  return 'Answer the next one and I will re-score.';
}
