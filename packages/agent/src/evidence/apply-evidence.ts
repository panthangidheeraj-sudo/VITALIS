/**
 * Turns freshly-observed facts into the append-only evidence log.
 *
 * Two distinct outcomes for a repeated concept id, and the difference matters
 * for contradiction resolution downstream (see `contradiction/resolve.ts`):
 *
 *   - The answer DIFFERS from what is currently active -> supersession. The
 *     old item is marked `supersededBy`, never mutated or deleted, and the
 *     new item carries `supersedes`. This is what lets the evidence log
 *     reconstruct a "denied it, then confirmed it" reversal.
 *   - The answer MATCHES but comes from a genuinely different report (a
 *     different `source` or `reliability` — a caregiver corroborating the
 *     patient, or the patient reaffirming after a targeted follow-up) -> a
 *     new item is still added, standing alongside the old one as independent
 *     corroboration.
 *
 * That second case is deliberate, not an oversight. If a caregiver's report
 * conflicting with the patient were treated as self-resolving, the agent
 * would settle a contradiction using the very evidence that created it — the
 * opposite of the spec's "ask harder-to-deflect follow-ups before finalising"
 * requirement. Resolving a contradiction needs an INDEPENDENT second source,
 * and that source has to leave a record for `resolveContradictions` to find.
 * Only a true repeat — same concept, same answer, same source, same
 * reliability — is a no-op restatement and gets dropped.
 */

import type {
  ChoiceId,
  ConceptId,
  ConceptType,
  EvidenceItem,
  EvidenceReliability,
  EvidenceSource,
  IsoTimestamp,
  TurnId,
} from '@triage/shared';
import { activeEvidence, asEvidenceId } from '@triage/shared';
import type { IdPort } from '@triage/shared';

export interface NewEvidenceInput {
  readonly conceptId: ConceptId;
  readonly conceptType: ConceptType;
  readonly name: string;
  readonly commonName?: string;
  readonly choiceId: ChoiceId;
  readonly source: EvidenceSource;
  readonly reliability: EvidenceReliability;
  readonly rawText?: string;
  readonly turnId?: TurnId;
  readonly onsetAt?: IsoTimestamp;
}

export interface ApplyEvidenceResult {
  /** The full, updated evidence log — supersession links applied. */
  readonly evidence: readonly EvidenceItem[];
  /** Only the items actually added this call, for contradiction-checking and the timeline. */
  readonly added: readonly EvidenceItem[];
}

export function applyEvidence(
  current: readonly EvidenceItem[],
  incoming: readonly NewEvidenceInput[],
  observedAt: IsoTimestamp,
  ids: Pick<IdPort, 'newId'>,
): ApplyEvidenceResult {
  let evidence = [...current];
  const added: EvidenceItem[] = [];

  for (const input of incoming) {
    const activeMatches = activeEvidence(evidence).filter((e) => e.conceptId === input.conceptId);

    const exactRepeat = activeMatches.find(
      (e) =>
        e.choiceId === input.choiceId &&
        e.source === input.source &&
        e.reliability === input.reliability,
    );
    if (exactRepeat !== undefined) continue;

    // Only a DIFFERING answer is something to replace. A matching answer from
    // a new source stands alongside the existing one(s) — see file header.
    const conflicting = activeMatches.find((e) => e.choiceId !== input.choiceId);

    const newItem: EvidenceItem = {
      id: asEvidenceId(ids.newId('ev')),
      conceptId: input.conceptId,
      conceptType: input.conceptType,
      name: input.name,
      ...(input.commonName !== undefined ? { commonName: input.commonName } : {}),
      choiceId: input.choiceId,
      source: input.source,
      reliability: input.reliability,
      ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
      ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
      observedAt,
      ...(input.onsetAt !== undefined ? { onsetAt: input.onsetAt } : {}),
      ...(conflicting !== undefined ? { supersedes: conflicting.id } : {}),
    };

    if (conflicting !== undefined) {
      evidence = evidence.map((e) =>
        e.id === conflicting.id ? { ...e, supersededBy: newItem.id } : e,
      );
    }

    evidence = [...evidence, newItem];
    added.push(newItem);
  }

  return { evidence, added };
}
