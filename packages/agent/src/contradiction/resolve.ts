/**
 * Contradiction lifecycle: merging newly-detected conflicts in, and resolving
 * old ones out.
 *
 * RESOLUTION REQUIRES AN INDEPENDENT SECOND SOURCE, NOT THE FLIP ITSELF.
 * A contradiction is created from exactly two evidence items that disagree —
 * if resolving it only needed one of those same two items, the agent would be
 * settling the conflict using the very evidence that created it, which is the
 * opposite of §5.1's "ask harder-to-deflect follow-ups before finalising".
 * So a contradiction resolves only when a THIRD, independent evidence item
 * touching the same concept arrives after it was detected — a caregiver's
 * report confirmed by the patient answering directly, or vice versa. Until
 * that independent confirmation shows up, the contradiction — and the
 * routing block it causes — stays open no matter how many times the same
 * source repeats itself.
 *
 * This is still deterministic, not a model judgement call, consistent with
 * §7's "fact vs hypothesis, always structurally separated": whether a
 * SPECIFIC, IDENTIFIED item independently confirms a concept is a fact about
 * the evidence graph, checked here — not re-litigated by Groq.
 */

import type { Contradiction, EvidenceItem, IsoTimestamp } from '@triage/shared';
import { unresolvedContradictions } from '@triage/shared';

/**
 * Resolves any unresolved contradiction once an independent piece of new
 * evidence — one whose id is not already part of the conflict — touches the
 * same concept. `evidence` must be the full, up-to-date log (so conflicting
 * evidence ids can be mapped back to concept ids); `newlyAdded` is just this
 * turn's additions. Never mutates; returns a new array.
 */
export function resolveContradictions(
  contradictions: readonly Contradiction[],
  evidence: readonly EvidenceItem[],
  newlyAdded: readonly EvidenceItem[],
  now: IsoTimestamp,
): readonly Contradiction[] {
  if (newlyAdded.length === 0) return contradictions;
  const byId = new Map(evidence.map((e) => [e.id, e]));

  return contradictions.map((c) => {
    if (c.resolvedAt !== undefined) return c;

    const conceptIds = new Set(
      c.conflictingEvidenceIds
        .map((id) => byId.get(id)?.conceptId)
        .filter((id): id is string => id !== undefined),
    );

    const confirming = newlyAdded.find(
      (e) => conceptIds.has(e.conceptId) && !c.conflictingEvidenceIds.includes(e.id),
    );
    if (confirming === undefined) return c;

    return {
      ...c,
      resolvedAt: now,
      resolutionNote:
        `Resolved by independent confirmation from ${confirming.source} ` +
        `(${confirming.reliability}): "${confirming.rawText ?? confirming.commonName ?? confirming.name}".`,
    };
  });
}

/**
 * Folds freshly-detected contradictions (from `ReasoningPort.detectContradiction`)
 * into the record, skipping ones that already exist. Two contradictions are
 * the same if they cite the same conflicting evidence and the same kind — a
 * different citation is a different finding even if the kind repeats.
 */
export function mergeContradictions(
  existing: readonly Contradiction[],
  detected: readonly Contradiction[],
): readonly Contradiction[] {
  const seen = new Set(
    existing.map((c) => `${c.kind}:${[...c.conflictingEvidenceIds].sort().join(',')}`),
  );
  const fresh = detected.filter(
    (c) => !seen.has(`${c.kind}:${[...c.conflictingEvidenceIds].sort().join(',')}`),
  );
  return [...existing, ...fresh];
}

export function hasUnresolved(contradictions: readonly Contradiction[]): boolean {
  return unresolvedContradictions({ contradictions }).length > 0;
}
