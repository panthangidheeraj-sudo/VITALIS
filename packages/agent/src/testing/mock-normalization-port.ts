/**
 * A keyword-lexicon stand-in for Infermedica `/parse` and `/search`. Real NLP
 * is out of scope for a test double; this matches literal substrings against
 * a small table the test supplies, which is enough to exercise the loop's
 * evidence-extraction and supersession logic deterministically.
 */

import type { BiologicalSex, ChoiceId, ConceptType, EvidenceNormalizationPort, ParsedMention, ToolResult } from '@triage/shared';
import { liveResult } from '@triage/shared';

export interface LexiconEntry {
  readonly match: string;
  readonly id: string;
  readonly type: ConceptType;
  readonly name: string;
  readonly commonName?: string;
  readonly choiceId: ChoiceId;
}

export class MockNormalizationPort implements EvidenceNormalizationPort {
  constructor(private readonly lexicon: readonly LexiconEntry[]) {}

  async parse(request: { text: string }): Promise<ToolResult<readonly ParsedMention[]>> {
    const lower = request.text.toLowerCase();
    const mentions: ParsedMention[] = this.lexicon
      .filter((entry) => lower.includes(entry.match.toLowerCase()))
      .map((entry) => ({
        id: entry.id,
        type: entry.type,
        name: entry.name,
        ...(entry.commonName !== undefined ? { commonName: entry.commonName } : {}),
        choiceId: entry.choiceId,
        orth: entry.match,
      }));
    return liveResult(mentions, 1);
  }

  async search(
    term: string,
    _options: { readonly ageYears: number; readonly sex?: BiologicalSex },
  ): Promise<ToolResult<readonly ParsedMention[]>> {
    void _options;
    const lower = term.toLowerCase();
    const match = this.lexicon.find(
      (entry) => entry.match.toLowerCase().includes(lower) || lower.includes(entry.match.toLowerCase()),
    );
    const mentions: ParsedMention[] = match
      ? [
          {
            id: match.id,
            type: match.type,
            name: match.name,
            ...(match.commonName !== undefined ? { commonName: match.commonName } : {}),
            choiceId: 'present',
            orth: term,
          },
        ]
      : [];
    return liveResult(mentions, 1);
  }
}
