/**
 * Shared zod primitives.
 *
 * Note on typing: these schemas validate at runtime; they are deliberately not
 * asserted to be type-identical to the TypeScript interfaces in `src/types`.
 * Zod's `.optional()` infers `T | undefined`, which `exactOptionalPropertyTypes`
 * treats as distinct from `prop?: T`. Chasing that identity adds noise for no
 * safety — the interfaces are the compile-time contract, these are the runtime
 * gate, and `parseCaseState` bridges them at the one trust boundary.
 */

import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '../types/common.js';

/** ISO-8601 UTC instant, e.g. `2026-09-12T07:04:00.000Z`. */
export const isoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
    'Must be an ISO-8601 UTC timestamp ending in Z',
  );

export const languageSchema = z.enum(SUPPORTED_LANGUAGES);

/** Infermedica concept id: `s_` symptom, `p_` risk factor, `lt_` lab test. */
export const conceptIdSchema = z
  .string()
  .regex(/^(s|p|lt)_\d+$/, 'Must be an Infermedica concept id (s_*, p_* or lt_*)');

export const choiceIdSchema = z.enum(['present', 'absent', 'unknown']);

export const conceptTypeSchema = z.enum(['symptom', 'risk_factor', 'lab_test']);

/** E.164, as Twilio requires. */
export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Must be an E.164 phone number, e.g. +919876543210');

export const unitIntervalSchema = z.number().min(0).max(1);

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().optional(),
});

export const geoFixSchema = geoPointSchema.extend({
  at: isoTimestampSchema,
  source: z.enum(['browser_geolocation', 'manual_entry', 'caregiver_report', 'fixture']),
});

export const citationSchema = z.object({
  provider: z.enum(['medlineplus', 'infermedica', 'rxnorm', 'icd11', 'wikipedia']),
  title: z.string().min(1),
  url: z.string().url().optional(),
  conceptId: z.string().optional(),
  retrievedAt: isoTimestampSchema,
});

export const biologicalSexSchema = z.enum(['male', 'female']);
