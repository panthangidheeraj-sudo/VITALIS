/**
 * Injury APPEARANCE tracking — the structured record of what successive
 * photographs of the same injury showed, and whether it is changing.
 *
 * THE LINE THIS TYPE EXISTS TO HOLD: none of this is a risk tier, and none of
 * it is a diagnosis. `RiskAssessment.tier` (green/yellow/orange/red) is
 * produced by the deterministic scorer from normalised evidence, and nothing
 * here feeds it directly — a photo contributes EVIDENCE (see the orchestrator's
 * `source: 'photo_observation'` path), and the scorer decides what that
 * evidence means. `InjurySeverity` is a separate, deliberately coarse
 * description of how the injury LOOKS, computed by a pure function from the
 * closed `VISIBLE_SIGNS` vocabulary — see policy/injury-appearance.ts. The
 * vision model never returns a severity, so it cannot assert one.
 *
 * Consequently every label here is worded as appearance, not conclusion:
 * "visible characteristics are consistent with…", never "this is a severe
 * injury."
 */

import type { IsoTimestamp } from './common.js';

/**
 * Deliberately four coarse buckets, with an explicit "cannot tell" that is a
 * first-class outcome rather than a failure — a dark, blurry or cropped photo
 * must never be flattened into "mild".
 */
export const INJURY_SEVERITIES = ['mild', 'moderate', 'severe', 'unable_to_assess'] as const;
export type InjurySeverity = (typeof INJURY_SEVERITIES)[number];

/**
 * `unknown` is used whenever a comparison is not actually supported — a first
 * photo, an unreadable photo, or two photos whose signs simply differ without
 * one being worse. The UI must never render a direction the data does not
 * justify.
 */
export const INJURY_TRENDS = ['worsening', 'stable', 'improving', 'unknown'] as const;
export type InjuryTrend = (typeof INJURY_TRENDS)[number];

/** One photograph, converted into structure. */
export interface InjuryObservation {
  readonly id: string;
  readonly at: IsoTimestamp;
  /** From the closed VISIBLE_SIGNS vocabulary the vision schema enforces. */
  readonly visibleSigns: readonly string[];
  /** The model's prose description of what is visible. Never a diagnosis. */
  readonly description: string;
  /** Computed from `visibleSigns` by a pure function, not asked of the model. */
  readonly severity: InjurySeverity;
  /** The photo's own legibility, 0–1. Low quality forces `unable_to_assess`. */
  readonly imageQuality: number;
  /** Versus the PREVIOUS observation on this case. `unknown` for the first. */
  readonly trend: InjuryTrend;
  /** Plain-language reason the trend was assigned, e.g. "swelling is new". */
  readonly trendDetail?: string;
  /** An opaque id for the image, never the image data itself. */
  readonly imageReference?: string;
}

/** The rolling record kept on the case. */
export interface InjuryTracking {
  readonly observations: readonly InjuryObservation[];
  readonly currentSeverity: InjurySeverity;
  readonly currentTrend: InjuryTrend;
}
