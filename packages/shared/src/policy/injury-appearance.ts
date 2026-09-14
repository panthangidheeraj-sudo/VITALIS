/**
 * Deterministic appearance policy for injury photos.
 *
 * WHY THIS IS A PURE FUNCTION AND NOT A MODEL CALL: the vision model is asked
 * exactly one thing — which of the closed `VISIBLE_SIGNS` it can see, plus how
 * legible the photo is. Turning that into a severity label, and turning two
 * successive labels into a trend, happens HERE, in code, where it is
 * inspectable, testable, and identical every time. A model that could return
 * "severe" directly would be a model deciding clinical urgency from a picture,
 * which is precisely the thing the architecture forbids.
 *
 * It is also deliberately conservative in both directions:
 *   - an illegible photo is `unable_to_assess`, never `mild`;
 *   - a trend is only ever reported when the sign sets actually support it,
 *     otherwise `unknown`.
 */

import type { InjuryObservation, InjurySeverity, InjuryTrend } from '../types/injury.js';

/**
 * Signs that, on their own, warrant the top appearance bucket. These are the
 * ones where "it looks bad" and "it is bad" are least likely to diverge.
 */
const SEVERE_SIGNS: readonly string[] = ['heavy_bleeding', 'deformity', 'foreign_object'];

/** Signs that raise the appearance above "mild" without reaching the top. */
const MODERATE_SIGNS: readonly string[] = ['bleeding', 'burn', 'blistering', 'open_wound', 'pallor'];

/**
 * Below this, the photo is not a usable observation — the same 0.3 floor the
 * orchestrator already applies before letting a photo become evidence, kept in
 * one place so the two cannot drift apart.
 */
export const MIN_USABLE_IMAGE_QUALITY = 0.3;

/** Ordered worst → best, for comparisons. Index is the rank. */
const SEVERITY_RANK: readonly InjurySeverity[] = ['mild', 'moderate', 'severe'];

export function severityFromSigns(
  visibleSigns: readonly string[],
  imageQuality: number,
): InjurySeverity {
  if (imageQuality < MIN_USABLE_IMAGE_QUALITY) return 'unable_to_assess';
  if (visibleSigns.length === 0) return 'unable_to_assess';
  // "none_visible" is a real answer from the model — it means the photo was
  // readable and showed nothing notable, which is NOT the same as an
  // unreadable photo and must not be reported as severity at all.
  if (visibleSigns.every((s) => s === 'none_visible')) return 'mild';
  if (visibleSigns.some((s) => SEVERE_SIGNS.includes(s))) return 'severe';
  if (visibleSigns.some((s) => MODERATE_SIGNS.includes(s))) return 'moderate';
  return 'mild';
}

function rankOf(severity: InjurySeverity): number | undefined {
  const index = SEVERITY_RANK.indexOf(severity);
  return index === -1 ? undefined : index;
}

/**
 * Compares a new observation against the previous one on the same case.
 *
 * Returns `unknown` — with a reason — rather than guessing whenever either
 * photo was unusable, because "improving" shown to someone whose wound is in
 * fact worsening is an actively dangerous falsehood.
 */
export function compareObservations(
  previous: InjuryObservation | undefined,
  next: { readonly visibleSigns: readonly string[]; readonly severity: InjurySeverity },
): { readonly trend: InjuryTrend; readonly detail?: string } {
  if (previous === undefined) {
    return { trend: 'unknown', detail: 'First photo of this injury — nothing to compare against yet.' };
  }

  const prevRank = rankOf(previous.severity);
  const nextRank = rankOf(next.severity);
  if (prevRank === undefined || nextRank === undefined) {
    return {
      trend: 'unknown',
      detail: 'One of the two photos was not clear enough to compare.',
    };
  }

  const gained = next.visibleSigns.filter((s) => s !== 'none_visible' && !previous.visibleSigns.includes(s));
  const lost = previous.visibleSigns.filter((s) => s !== 'none_visible' && !next.visibleSigns.includes(s));
  const readable = (signs: readonly string[]) => signs.map((s) => s.replace(/_/g, ' ')).join(', ');

  if (nextRank > prevRank) {
    return {
      trend: 'worsening',
      detail:
        gained.length > 0
          ? `Appearance suggests higher concern than the last photo — now also showing ${readable(gained)}.`
          : 'Appearance suggests higher concern than the last photo.',
    };
  }
  if (nextRank < prevRank) {
    return {
      trend: 'improving',
      detail:
        lost.length > 0
          ? `Fewer visible signs than the last photo — no longer showing ${readable(lost)}.`
          : 'Appearance suggests less concern than the last photo.',
    };
  }

  // Same severity bucket. New signs at the same rank still matter enough to
  // report as a change rather than claiming "stable".
  if (gained.length > 0) {
    return {
      trend: 'unknown',
      detail: `Similar overall, but ${readable(gained)} is visible now that was not before — worth checking.`,
    };
  }
  return { trend: 'stable', detail: 'Visible signs look much the same as the last photo.' };
}

/** Human-facing label. Always phrased as appearance, never as a conclusion. */
export function severityLabel(severity: InjurySeverity): string {
  switch (severity) {
    case 'mild':
      return 'Visible signs are limited';
    case 'moderate':
      return 'Visible characteristics warrant attention';
    case 'severe':
      return 'Appearance suggests higher concern';
    case 'unable_to_assess':
      return 'Not clear enough to assess from the photo';
  }
}
