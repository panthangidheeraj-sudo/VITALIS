/**
 * The model cannot score.
 *
 * Spec §6 separates "explaining a symptom" from "issuing a clinical risk
 * classification" and puts them in different layers. A system prompt saying so
 * is not an enforcement mechanism — a model under an unusual prompt will
 * happily emit a severity number if a field exists to hold one.
 *
 * These tests assert the field does not exist, in either the zod schema or the
 * JSON Schema handed to Groq's structured-outputs parameter, and that the two
 * agree with each other so neither can drift.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  FORBIDDEN_MODEL_OUTPUT_KEYS,
  GROQ_JSON_SCHEMAS,
  GROQ_SCHEMA_PAIRS,
  composedResponseSchema,
  contradictionListSchema,
  photoObservationSchema,
  selectedQuestionSchema,
} from './groq-outputs.js';

function collectKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (value === null || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return found;
  }
  const obj = value as Record<string, unknown>;
  if (obj['properties'] !== undefined && typeof obj['properties'] === 'object') {
    for (const key of Object.keys(obj['properties'] as object)) found.add(key);
  }
  for (const nested of Object.values(obj)) collectKeys(nested, found);
  return found;
}

describe('no Groq output schema can carry a clinical classification', () => {
  it('declares no forbidden key in any JSON Schema', () => {
    for (const [name, schema] of Object.entries(GROQ_JSON_SCHEMAS)) {
      const keys = collectKeys(schema);
      for (const forbidden of FORBIDDEN_MODEL_OUTPUT_KEYS) {
        expect(keys, `${name} must not expose "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });

  it('declares no forbidden key in any zod schema', () => {
    for (const { name, zod } of GROQ_SCHEMA_PAIRS) {
      const shape = (zod as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      for (const forbidden of FORBIDDEN_MODEL_OUTPUT_KEYS) {
        expect(Object.keys(shape), `${name} must not expose "${forbidden}"`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it('strips an injected severity field rather than passing it through', () => {
    const contaminated = {
      text: 'Does the pain spread anywhere else?',
      targetConceptIds: ['s_98'],
      rationale: 'Radiation is the strongest discriminator at this point.',
      expectedInformationGain: 0.72,
      language: 'en',
      hardToDeflect: false,
      severityOutOfTen: 9,
      riskTier: 'red',
    };
    const parsed = selectedQuestionSchema.parse(contaminated);
    expect(parsed).not.toHaveProperty('severityOutOfTen');
    expect(parsed).not.toHaveProperty('riskTier');
  });
});

describe('JSON Schema and zod agree', () => {
  /**
   * Groq's strict structured-output mode rejects any schema whose `required`
   * omits a declared property, so `required` cannot mirror zod's optionality
   * directly. The contract is instead:
   *   - the JSON Schema requires EVERY property (Groq's rule), and
   *   - anything zod treats as optional is declared NULLABLE there.
   * A field added to one side and forgotten on the other still fails here.
   */
  it('declares every property as required, as Groq strict mode demands', () => {
    for (const { name } of GROQ_SCHEMA_PAIRS) {
      const jsonSchema = GROQ_JSON_SCHEMAS[name as keyof typeof GROQ_JSON_SCHEMAS];
      const properties = Object.keys(jsonSchema.properties as Record<string, unknown>);
      const required = [...(jsonSchema.required as readonly string[])];
      expect(
        required.sort(),
        `${name}: Groq rejects a strict schema whose required omits a property`,
      ).toEqual(properties.sort());
    }
  });

  it('expresses zod-optional fields as nullable rather than absent', () => {
    for (const { name, zod } of GROQ_SCHEMA_PAIRS) {
      const jsonSchema = GROQ_JSON_SCHEMAS[name as keyof typeof GROQ_JSON_SCHEMAS];
      const properties = jsonSchema.properties as Record<string, { type?: unknown }>;
      const shape = (zod as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;

      for (const [key, schema] of Object.entries(shape)) {
        const declared = properties[key];
        expect(declared, `${name}.${key} is missing from the JSON Schema`).toBeDefined();
        if (!schema.isOptional()) continue;

        const type = declared?.type;
        expect(
          Array.isArray(type) && type.includes('null'),
          `${name}.${key} is optional in zod but not nullable in the JSON Schema`,
        ).toBe(true);
      }
    }
  });

  it('covers every declared pair with a JSON Schema', () => {
    for (const { name } of GROQ_SCHEMA_PAIRS) {
      expect(GROQ_JSON_SCHEMAS).toHaveProperty(name);
    }
    expect(Object.keys(GROQ_JSON_SCHEMAS).sort()).toEqual(
      GROQ_SCHEMA_PAIRS.map((p) => p.name).sort(),
    );
  });
});

describe('the verification gate rejects malformed model output', () => {
  it('rejects a question with no target concept', () => {
    expect(
      selectedQuestionSchema.safeParse({
        text: 'How are you feeling?',
        targetConceptIds: [],
        rationale: 'General check-in.',
        expectedInformationGain: 0.1,
        language: 'en',
        hardToDeflect: false,
      }).success,
    ).toBe(false);
  });

  it('rejects a target that is not an Infermedica concept id', () => {
    expect(
      selectedQuestionSchema.safeParse({
        text: 'Does it spread?',
        targetConceptIds: ['chest pain'],
        rationale: 'Radiation check.',
        expectedInformationGain: 0.7,
        language: 'en',
        hardToDeflect: false,
      }).success,
    ).toBe(false);
  });

  it('rejects an information-gain estimate outside 0..1', () => {
    expect(
      selectedQuestionSchema.safeParse({
        text: 'Does it spread?',
        targetConceptIds: ['s_98'],
        rationale: 'Radiation check.',
        expectedInformationGain: 7,
        language: 'en',
        hardToDeflect: false,
      }).success,
    ).toBe(false);
  });

  it('rejects a contradiction citing fewer than two pieces of evidence', () => {
    expect(
      contradictionListSchema.safeParse({
        contradictions: [
          {
            kind: 'cross_turn_reversal',
            detail: 'Something changed.',
            conflictingEvidenceIds: ['ev_1'],
            certainty: 0.9,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects an unlisted visible sign in a photo observation', () => {
    expect(
      photoObservationSchema.safeParse({
        visibleSigns: ['compound_fracture_of_the_radius'],
        description: 'Visible injury to the forearm.',
        suggestedConceptTerms: ['arm injury'],
        imageQuality: 0.8,
      }).success,
    ).toBe(false);
  });

  it('requires every composed response to end with a concrete next step (§8)', () => {
    expect(
      composedResponseSchema.safeParse({
        message: 'That sounds serious.',
        language: 'en',
      }).success,
    ).toBe(false);

    expect(
      composedResponseSchema.safeParse({
        message: 'Understood. Chest pain spreading to the arm is serious.',
        nextStep: 'Are you having any trouble breathing right now?',
        language: 'en',
      }).success,
    ).toBe(true);
  });

  it('accepts a well-formed photo observation and keeps quality separate from certainty', () => {
    const result = photoObservationSchema.parse({
      visibleSigns: ['bleeding', 'swelling'],
      description: 'Active bleeding from a laceration on the left forearm, with swelling.',
      suggestedConceptTerms: ['bleeding', 'swelling of the arm'],
      imageQuality: 0.42,
    });
    expect(result.imageQuality).toBeLessThan(0.5);
    expect(result.visibleSigns).toContain('bleeding');
  });
});
