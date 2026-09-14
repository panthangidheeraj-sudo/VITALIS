/**
 * The acceptance test for the contract layer.
 *
 * `demo-chest-pain.json` encodes the entire six-beat judged sequence from
 * spec §11. If the schema cannot express it, the schema is wrong — that is the
 * point of validating the fixture rather than a hand-written object literal.
 *
 * It also pins the §5.4 anchor trace (7:00 → 7:02 → 7:04 → 7:05) that the demo
 * video is built around, so a later refactor cannot quietly break the thing
 * being filmed.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { activeEvidence, toInfermedicaEvidence } from '../types/evidence.js';
import { deriveClinicalFields } from '../types/handoff.js';
import { clinicalHighlights, sortChronologically } from '../types/timeline.js';
import { isClinicalScoring, TOOL_ROLES } from '../types/tool-call.js';
import {
  allowedRoutingOutcomes,
  requiredGate,
  tierFor,
  verifyDecision,
} from '../policy/risk-policy.js';
import { caseStateSchema, demoFixtureSchema } from './case.js';

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/demo-chest-pain.json',
);
const raw: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));

const parsed = demoFixtureSchema.parse(raw);
const { case: demoCase, timeline, toolCalls } = parsed;

describe('fixture validates against the production schema', () => {
  it('parses cleanly', () => {
    const result = demoFixtureSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Fixture failed validation:\n${result.error.issues
          .map((i) => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n')}`,
      );
    }
    expect(result.success).toBe(true);
  });

  it('is validated by the same schema the Firestore read path uses', () => {
    expect(caseStateSchema.safeParse(demoCase).success).toBe(true);
  });
});

describe('beat 1–2 — goal and decision', () => {
  it('opens with an incomplete state: a single initial complaint', () => {
    const initial = demoCase.evidence.filter((e) => e.source === 'initial_complaint');
    expect(initial).toHaveLength(1);
    expect(initial[0]?.conceptId).toBe('s_21');
  });

  it('records a question selected with a stated rationale, not a fixed script', () => {
    const asked = timeline.find((e) => e.kind === 'question_asked');
    expect(asked).toBeDefined();
    expect(asked?.detail).toBeTruthy();
    expect(asked?.provenance).toBe('agent_inference');
  });
});

describe('beat 3–4 — action and intermediate result', () => {
  it('calls the clinical scoring tool twice, before and after the new symptoms', () => {
    const triageCalls = toolCalls.filter((c) => c.tool === 'infermedica.triage');
    expect(triageCalls).toHaveLength(2);
    expect(triageCalls[0]?.resultDigest).toContain('consultation_24');
    expect(triageCalls[1]?.resultDigest).toContain('emergency_ambulance');
  });

  it('normalises free text through /parse before scoring — /triage takes concept ids only', () => {
    const parseCalls = toolCalls.filter((c) => c.tool === 'infermedica.parse');
    const firstTriage = toolCalls.find((c) => c.tool === 'infermedica.triage');
    expect(parseCalls.length).toBeGreaterThan(0);
    expect(parseCalls[0]!.startedAt < firstTriage!.startedAt).toBe(true);
  });

  it('reaches yellow before it reaches red', () => {
    const changes = timeline.filter((e) => e.kind === 'risk_tier_changed');
    expect(changes.map((e) => e.riskTierAfter)).toEqual(['orange', 'red']);
  });
});

describe('beat 5 — adaptation (the §5.4 anchor trace)', () => {
  const at = (time: string) => timeline.filter((e) => e.at.startsWith(`2026-09-12T${time}`));

  it('7:00 — chest pain starts', () => {
    expect(at('07:00').some((e) => e.summary === 'Chest pain starts')).toBe(true);
  });

  it('7:02 — pain spreads to left arm', () => {
    expect(at('07:02').some((e) => e.summary === 'Pain spreads to left arm')).toBe(true);
  });

  it('7:04 — shortness of breath begins', () => {
    expect(at('07:04').some((e) => e.summary === 'Shortness of breath begins')).toBe(true);
  });

  it('7:05 — risk upgraded to Red', () => {
    const upgrade = at('07:05').find((e) => e.kind === 'risk_tier_changed');
    expect(upgrade?.riskTierBefore).toBe('orange');
    expect(upgrade?.riskTierAfter).toBe('red');
  });

  it('records the trace in chronological order', () => {
    const sorted = sortChronologically(timeline as never);
    expect(sorted.map((e) => e.id)).toEqual(timeline.map((e) => e.id));
  });

  it('shows an explicit re-plan, with the abandoned action named', () => {
    const adaptation = timeline.find((e) => e.kind === 'adaptation');
    expect(adaptation?.detail).toContain('ask_question');
    expect(adaptation?.detail).toContain('score_now');
  });

  it('raises and then clears a confidence alert from a self-report contradiction', () => {
    expect(timeline.some((e) => e.kind === 'confidence_alert_raised')).toBe(true);
    expect(timeline.some((e) => e.kind === 'confidence_alert_cleared')).toBe(true);
    expect(
      demoCase.confidence.contradictions.some((c) => c.kind === 'self_report_vs_evidence'),
    ).toBe(true);
  });

  it('rejects a one-sided supersession link', () => {
    // Regression guard: the fixture originally marked ev_007 as superseding
    // ev_003 without marking ev_003 as superseded, which left a stale "not
    // sweating" answer active and reaching the scoring engine.
    const broken = structuredClone(demoCase) as {
      evidence: { id: string; supersededBy?: string }[];
    };
    const stale = broken.evidence.find((e) => e.id === 'ev_003')!;
    delete stale.supersededBy;
    expect(caseStateSchema.safeParse(broken).success).toBe(false);
  });

  it('supersedes the reversed answer instead of deleting it', () => {
    const superseded = demoCase.evidence.find((e) => e.id === 'ev_006');
    const replacement = demoCase.evidence.find((e) => e.id === 'ev_005');
    expect(superseded?.choiceId).toBe('absent');
    expect(superseded?.supersededBy).toBe('ev_005');
    expect(replacement?.choiceId).toBe('present');
    expect(activeEvidence(demoCase.evidence as never).map((e) => e.id)).not.toContain('ev_006');
  });

  it('sends only active evidence to the scoring engine', () => {
    const sent = toInfermedicaEvidence(demoCase.evidence as never);
    expect(sent.map((e) => e.id)).not.toContain(undefined);
    expect(sent).toHaveLength(5);
    expect(sent.filter((e) => e.id === 's_13')).toHaveLength(1);
  });
});

describe('beat 6 — final outcome', () => {
  it('routes to ambulance dispatch behind a satisfied 3-second hold', () => {
    expect(demoCase.routing?.outcome).toBe('ambulance_dispatch');
    expect(demoCase.routing?.gate.kind).toBe('press_and_hold_3s');
    expect(demoCase.routing?.gate.requiredHoldMs).toBe(3000);
    expect(demoCase.routing?.gate.state).toBe('satisfied');
  });

  it('confirms only after the gate was satisfied, never before', () => {
    const gateAt = demoCase.routing!.gate.satisfiedAt!;
    const confirmedAt = demoCase.routing!.confirmedAt!;
    const proposedAt = demoCase.routing!.proposedAt;
    expect(proposedAt < gateAt).toBe(true);
    expect(confirmedAt >= gateAt).toBe(true);
  });

  it('passes the policy verification gate', () => {
    const routing = demoCase.routing!;
    expect(
      verifyDecision({
        outcome: routing.outcome,
        gate: requiredGate(routing.outcome),
        tier: demoCase.risk.tier,
        confidenceLevel: demoCase.confidence.level,
        unresolvedContradictionCount: demoCase.confidence.contradictions.filter(
          (c) => c.resolvedAt === undefined,
        ).length,
      }),
    ).toEqual({ valid: true });
  });

  it('matches a hospital by required specialty with provenance stated', () => {
    expect(demoCase.hospital?.specialtyMatched).toBe(true);
    expect(demoCase.hospital?.requiredSpecialty).toBe('cardiology');
    expect(demoCase.hospital?.hospital.dataProvenance.location).toBe('openstreetmap');
  });

  it('carries no simulated capacity data on the hospital record', () => {
    // Bed availability was a deterministic fake carried beside real OSM
    // fields. It is gone; this guards against it being reintroduced as a
    // "harmless" demo nicety.
    expect(demoCase.hospital?.hospital).not.toHaveProperty('bedAvailability');
    expect(JSON.stringify(demoCase.hospital)).not.toMatch(/bed/i);
  });

  it('sends the pre-arrival summary and marks it simulated', () => {
    expect(demoCase.preArrival?.simulated).toBe(true);
    expect(demoCase.preArrival?.acknowledged).toBe(true);
  });

  it('keeps monitoring after triage instead of terminating', () => {
    expect(demoCase.companion.active).toBe(true);
    expect(demoCase.companion.reassessmentCount).toBeGreaterThan(0);
    expect(demoCase.status).toBe('action_taken');
  });
});

describe('handoff card derives every clinical field from the assessment', () => {
  const derived = deriveClinicalFields(demoCase.risk as never);

  it('takes severity from the triage level, not from a model', () => {
    expect(derived.severityOutOfTen).toBe(10);
    expect(derived.triageLevel).toBe('emergency_ambulance');
  });

  it('flags a classic presentation from engine-supplied evidence only', () => {
    expect(derived.classicPresentation).toBe(true);
    expect(derived.classicPresentationBasis).toContain(
      'Chest pain with radiation to the left arm',
    );
  });

  it('reports a live, non-degraded scoring source', () => {
    expect(derived.scoringSource).toBe('infermedica');
    expect(derived.scoringDegradedReason).toBeUndefined();
  });
});

describe('tool ledger', () => {
  it('records a call for every external service the beats require', () => {
    const tools = new Set(toolCalls.map((c) => c.tool));
    for (const required of [
      'infermedica.parse',
      'infermedica.triage',
      'groq.select_next_question',
      'groq.detect_contradiction',
      'osm.find_hospitals',
      'twilio.send_message',
      'icd11.code',
    ]) {
      expect(tools).toContain(required);
    }
  });

  it('attributes the risk tier only to the clinical scoring tool', () => {
    const scoring = toolCalls.filter((c) => isClinicalScoring(c.tool as never));
    expect(scoring.every((c) => c.tool === 'infermedica.triage')).toBe(true);

    const groqCalls = toolCalls.filter((c) => c.tool.startsWith('groq.'));
    for (const call of groqCalls) {
      expect(TOOL_ROLES[call.tool as never]).not.toBe('clinical_scoring');
      expect(call.resultDigest ?? '').not.toMatch(/tier=|triage_level=/);
    }
  });

  it('carries a user-facing notice on every degraded or failed call (§6)', () => {
    const degraded = toolCalls.filter(
      (c) => c.status !== 'succeeded' && c.status !== 'started',
    );
    expect(degraded.length).toBeGreaterThan(0);
    for (const call of degraded) {
      expect(call.degradationNotice, `${call.tool} degraded without a notice`).toBeTruthy();
    }
  });

  it('keeps a knowledge-tool failure from contaminating the clinical score', () => {
    const failed = toolCalls.find((c) => c.tool === 'medlineplus.explain');
    expect(failed?.status).toBe('timed_out');
    expect(demoCase.risk.source).toBe('infermedica');
    expect(demoCase.degradation.clinicalScoringDegraded).toBe(false);
    expect(demoCase.degradation.affectedTools).toContain('medlineplus.explain');
  });

  it('stores redacted digests rather than raw payloads', () => {
    for (const call of toolCalls) {
      expect(call.argsDigest).not.toContain('heavy feeling in my chest');
      expect(call.argsDigest.length).toBeLessThan(200);
    }
  });
});

describe('case-level consistency', () => {
  it('agrees with the policy on the tier for its own triage level', () => {
    expect(demoCase.risk.tier).toBe(tierFor(demoCase.risk.triageLevel));
  });

  it('chose an outcome the allow-list permits at its own confidence level', () => {
    expect(allowedRoutingOutcomes(demoCase.risk.tier, demoCase.confidence.level)).toContain(
      demoCase.routing!.outcome,
    );
  });

  it('leaves no contradiction unresolved on a confirmed decision', () => {
    expect(demoCase.confidence.contradictions.every((c) => c.resolvedAt !== undefined)).toBe(
      true,
    );
    expect(demoCase.confidence.alertActive).toBe(false);
  });

  it('surfaces clinical highlights for the handoff card', () => {
    const highlights = clinicalHighlights(timeline as never);
    expect(highlights.length).toBeGreaterThan(3);
    expect(highlights.some((e) => e.kind === 'risk_tier_changed')).toBe(true);
  });

  it('quotes the patient verbatim for the handoff card', () => {
    const quotes = timeline.filter((e) => e.quotedText !== undefined);
    expect(quotes.length).toBeGreaterThanOrEqual(3);
    expect(quotes.map((e) => e.quotedText)).toContain('i cant breathe properly');
  });
});
