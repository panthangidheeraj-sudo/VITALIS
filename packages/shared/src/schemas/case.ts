/**
 * Runtime validators for the persisted case state.
 *
 * These guard two trust boundaries:
 *   1. Firestore → application. A document written by an older build, or
 *      hand-edited in the console during the hackathon, must not crash the
 *      loop silently or half-load.
 *   2. Fixture → tests. `demo-chest-pain.json` is only a meaningful acceptance
 *      test if it is validated against the same schema production data is.
 */

import { z } from 'zod';
import { CASE_MODES } from '../types/case-state.js';
import { INJURY_SEVERITIES, INJURY_TRENDS } from '../types/injury.js';
import { COMMUNICATION_STATES } from '../types/communication.js';
import { CONFIDENCE_LEVELS } from '../types/confidence.js';
import { RISK_TIERS, TRIAGE_LEVELS } from '../types/risk.js';
import { ROUTING_OUTCOMES } from '../types/routing.js';
import { HOSPITAL_SPECIALTIES } from '../types/hospital.js';
import {
  biologicalSexSchema,
  choiceIdSchema,
  citationSchema,
  conceptIdSchema,
  conceptTypeSchema,
  geoFixSchema,
  geoPointSchema,
  isoTimestampSchema,
  languageSchema,
  phoneE164Schema,
  unitIntervalSchema,
} from './primitives.js';

// --- Evidence ----------------------------------------------------------------

export const evidenceItemSchema = z.object({
  id: z.string().min(1),
  conceptId: conceptIdSchema,
  conceptType: conceptTypeSchema,
  name: z.string().min(1),
  commonName: z.string().optional(),
  choiceId: choiceIdSchema,
  source: z.enum([
    'initial_complaint',
    'question_answer',
    'photo_observation',
    'caregiver_report',
    'vital_measurement',
    'quick_select_tag',
    'patient_record',
    'companion_reassessment',
  ]),
  reliability: z.enum(['measured', 'reported', 'inferred', 'disputed']),
  rawText: z.string().optional(),
  turnId: z.string().optional(),
  observedAt: isoTimestampSchema,
  onsetAt: isoTimestampSchema.optional(),
  supersededBy: z.string().optional(),
  supersedes: z.string().optional(),
});

// --- Risk --------------------------------------------------------------------

export const seriousFlagSchema = z.object({
  id: conceptIdSchema,
  name: z.string().min(1),
  commonName: z.string().optional(),
  seriousness: z.enum(['serious', 'emergency']),
  isEmergency: z.boolean(),
});

export const triageTupleSchema = z.object({
  conceptIds: z.array(conceptIdSchema).min(2),
  label: z.string().min(1),
  citation: citationSchema.optional(),
});

export const riskAssessmentSchema = z
  .object({
    tier: z.enum(RISK_TIERS),
    triageLevel: z.enum(TRIAGE_LEVELS),
    rootCause: z.string().optional(),
    seriousFlags: z.array(seriousFlagSchema),
    triageTuples: z.array(triageTupleSchema),
    teleconsultationApplicable: z.boolean().optional(),
    source: z.enum(['local_rules', 'infermedica', 'local_fallback']),
    degradedReason: z.string().optional(),
    evidenceCount: z.number().int().nonnegative(),
    computedAt: isoTimestampSchema,
  })
  .refine(
    (r) => (r.source === 'local_fallback' ? r.degradedReason !== undefined : true),
    {
      message:
        'A local_fallback assessment must carry a degradedReason. Spec §6 forbids ' +
        'silently substituting a lower-confidence source.',
      path: ['degradedReason'],
    },
  );

// --- Confidence --------------------------------------------------------------

export const contradictionSchema = z.object({
  kind: z.enum([
    'self_report_vs_evidence',
    'cross_turn_reversal',
    'vital_vs_statement',
    'timeline_inconsistency',
    'caregiver_vs_patient',
  ]),
  detail: z.string().min(1),
  conflictingEvidenceIds: z.array(z.string()).min(2),
  priorTurnId: z.string().optional(),
  currentTurnId: z.string().optional(),
  detectedAt: isoTimestampSchema,
  resolvedAt: isoTimestampSchema.optional(),
  resolutionNote: z.string().optional(),
});

export const confidenceStateSchema = z.object({
  score: unitIntervalSchema,
  level: z.enum(CONFIDENCE_LEVELS),
  reasons: z.array(
    z.object({
      code: z.string().min(1),
      delta: z.number(),
      note: z.string(),
    }),
  ),
  contradictions: z.array(contradictionSchema),
  alertActive: z.boolean(),
  alertRaisedAt: isoTimestampSchema.optional(),
  updatedAt: isoTimestampSchema,
});

// --- Communication -----------------------------------------------------------

export const communicationReadSchema = z.object({
  state: z.enum(COMMUNICATION_STATES),
  certainty: unitIntervalSchema,
  signals: z.array(z.string()),
  detectedLanguage: z.string().optional(),
  since: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

// --- Routing -----------------------------------------------------------------

export const safetyGateSchema = z.object({
  kind: z.enum(['press_and_hold_3s', 'explicit_confirm', 'none']),
  state: z.enum(['not_required', 'pending', 'satisfied', 'cancelled']),
  consequenceStatement: z.string().min(1),
  requiredHoldMs: z.number().int().positive().optional(),
  satisfiedAt: isoTimestampSchema.optional(),
  cancelledAt: isoTimestampSchema.optional(),
});

export const routingDecisionSchema = z.object({
  outcome: z.enum(ROUTING_OUTCOMES),
  rationale: z.string().min(1),
  policyRule: z.string().min(1),
  gate: safetyGateSchema,
  proposedAt: isoTimestampSchema,
  confirmedAt: isoTimestampSchema.optional(),
  cancelledAt: isoTimestampSchema.optional(),
  basedOnRiskComputedAt: isoTimestampSchema,
});

export const dispatchStateSchema = z.object({
  status: z.enum([
    'not_dispatched',
    'dispatch_requested',
    'en_route',
    'arrived',
    'cancelled',
  ]),
  simulated: z.literal(true),
  requestedAt: isoTimestampSchema.optional(),
  etaMinutes: z.number().nonnegative().optional(),
  contactNumber: z.string().optional(),
  unitLabel: z.string().optional(),
  cancelledAt: isoTimestampSchema.optional(),
  cancelledBy: z.enum(['patient', 'caregiver', 'system']).optional(),
});

// --- Patient -----------------------------------------------------------------

export const medicationSchema = z.object({
  reportedName: z.string().min(1),
  rxcui: z.string().optional(),
  normalizedName: z.string().optional(),
  dose: z.string().optional(),
  frequency: z.string().optional(),
  interactionFlags: z.array(z.string()).optional(),
});

export const emergencyCardSchema = z.object({
  bloodGroup: z.string().optional(),
  allergies: z.array(z.string()),
  medications: z.array(medicationSchema),
  chronicConditions: z.array(z.string()),
  organDonor: z.boolean().optional(),
  notes: z.string().optional(),
  updatedAt: isoTimestampSchema,
});

export const emergencyContactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  relationship: z.enum([
    'spouse',
    'parent',
    'child',
    'sibling',
    'friend',
    'neighbour',
    'caregiver',
    'doctor',
    'other',
  ]),
  phoneE164: phoneE164Schema,
  whatsappEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  priority: z.number().int().nonnegative(),
  canRelay: z.boolean(),
});

export const vitalReadingSchema = z.object({
  kind: z.enum([
    'blood_pressure',
    'blood_glucose',
    'spo2',
    'heart_rate',
    'temperature',
    'respiratory_rate',
  ]),
  value: z.number(),
  secondaryValue: z.number().optional(),
  unit: z.string().min(1),
  measuredAt: isoTimestampSchema,
  source: z.enum(['manual_entry', 'device', 'caregiver', 'fixture']),
});

export const demographicsSchema = z.object({
  ageYears: z.number().int().min(0).max(130),
  sex: biologicalSexSchema,
  displayName: z.string().optional(),
  preferredLanguage: languageSchema,
  isMinor: z.boolean(),
});

// --- Hospital ----------------------------------------------------------------

export const hospitalSchema = z.object({
  osmId: z.string().min(1),
  name: z.string().min(1),
  location: geoPointSchema,
  address: z.string().optional(),
  phone: z.string().optional(),
  isPublic: z.boolean().optional(),
  specialties: z.array(z.enum(HOSPITAL_SPECIALTIES)),
  bedAvailability: z.object({
    simulated: z.literal(true),
    emergencyBedsFree: z.number().int().nonnegative(),
    icuBedsFree: z.number().int().nonnegative(),
    totalEmergencyBeds: z.number().int().nonnegative(),
    lastUpdated: isoTimestampSchema,
  }),
  hasEmergencyDepartment: z.boolean(),
  dataProvenance: z.object({
    location: z.enum(['openstreetmap', 'google_places', 'fixture']),
    specialties: z.literal('simulated'),
    bedAvailability: z.literal('simulated'),
  }),
});

export const hospitalMatchSchema = z.object({
  hospital: hospitalSchema,
  distanceKm: z.number().nonnegative(),
  estimatedTravelMinutes: z.number().nonnegative(),
  requiredSpecialty: z.enum(HOSPITAL_SPECIALTIES).optional(),
  specialtyMatched: z.boolean(),
  matchRationale: z.string().min(1),
  matchedAt: isoTimestampSchema,
});

export const preArrivalSummarySchema = z.object({
  caseId: z.string().min(1),
  sentAt: isoTimestampSchema,
  destinationOsmId: z.string().min(1),
  etaMinutes: z.number().nonnegative().optional(),
  simulated: z.literal(true),
  acknowledged: z.boolean(),
  acknowledgedAt: isoTimestampSchema.optional(),
});

// --- Notifications -----------------------------------------------------------

export const notificationRecordSchema = z.object({
  contactId: z.string().min(1),
  channel: z.enum(['whatsapp', 'sms', 'fcm_push']),
  kind: z.enum([
    'emergency_alert',
    'status_update',
    'location_share',
    'relay_request',
    'cancellation',
    'resolution',
  ]),
  status: z.enum(['queued', 'sent', 'delivered', 'failed', 'suppressed']),
  body: z.string(),
  sharedLocation: geoPointSchema.optional(),
  providerMessageId: z.string().optional(),
  failureReason: z.string().optional(),
  queuedAt: isoTimestampSchema,
  sentAt: isoTimestampSchema.optional(),
  deliveredAt: isoTimestampSchema.optional(),
});

export const relayStateSchema = z.object({
  active: z.boolean(),
  relayContactId: z.string().optional(),
  requestedAt: isoTimestampSchema.optional(),
  acceptedAt: isoTimestampSchema.optional(),
  reason: z
    .enum(['patient_unresponsive', 'patient_requested', 'minor_needs_adult'])
    .optional(),
  silenceSeconds: z.number().nonnegative().optional(),
});

// --- Case sub-states ---------------------------------------------------------

export const companionStateSchema = z.object({
  active: z.boolean(),
  intervalMs: z.number().int().positive(),
  lastReassessedAt: isoTimestampSchema.optional(),
  nextReassessmentDueAt: isoTimestampSchema.optional(),
  reassessmentCount: z.number().int().nonnegative(),
  trends: z.object({
    breathing: z.enum(['worsening', 'stable', 'improving']).optional(),
    consciousness: z.enum(['worsening', 'stable', 'improving']).optional(),
    bleeding: z.enum(['worsening', 'stable', 'improving']).optional(),
  }),
  activeFirstAidTopic: z.string().optional(),
});

export const escalationStateSchema = z.object({
  escalated: z.boolean(),
  reason: z
    .enum([
      'unresolved_contradiction_high_risk',
      'confidence_too_low_to_route',
      'clinical_scoring_unavailable',
      'patient_unresponsive',
      'explicit_user_request',
      'repeated_tool_failure',
    ])
    .optional(),
  detail: z.string().optional(),
  at: isoTimestampSchema.optional(),
});

export const degradationStateSchema = z.object({
  clinicalScoringDegraded: z.boolean(),
  notice: z.string().optional(),
  since: isoTimestampSchema.optional(),
  affectedTools: z.array(z.string()),
});

// --- Injury appearance tracking ---------------------------------------------

/**
 * Note what is NOT in this schema: a risk tier. Severity here describes how
 * the injury LOOKS across successive photos and is computed by
 * `policy/injury-appearance.ts` from the closed VISIBLE_SIGNS vocabulary —
 * `risk.tier` stays the deterministic scorer's sole output. The two are kept
 * in separate fields precisely so no UI or later edit can quietly conflate
 * "the photo looks bad" with "the engine classified this as red".
 */
export const injuryObservationSchema = z.object({
  id: z.string().min(1),
  at: isoTimestampSchema,
  visibleSigns: z.array(z.string()).max(8),
  description: z.string().max(600),
  severity: z.enum(INJURY_SEVERITIES),
  imageQuality: unitIntervalSchema,
  trend: z.enum(INJURY_TRENDS),
  trendDetail: z.string().max(300).optional(),
  /** An opaque id, never the image bytes — case documents are capped at 1 MiB. */
  imageReference: z.string().max(200).optional(),
});

export const injuryTrackingSchema = z.object({
  /** Capped: a case document has a hard size limit and this is a rolling log. */
  observations: z.array(injuryObservationSchema).max(20),
  currentSeverity: z.enum(INJURY_SEVERITIES),
  currentTrend: z.enum(INJURY_TRENDS),
});

// --- The case document -------------------------------------------------------

export const caseStateSchema = z
  .object({
    caseId: z.string().min(1),
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),

    // Non-empty, because "" would pass a bare string check and then fail the
    // security rule at read time, which is the failure this field exists to
    // prevent.
    ownerUid: z.string().min(1),
    relayUids: z.array(z.string().min(1)).optional(),

    status: z.enum([
      'interviewing',
      'awaiting_confirmation',
      'action_taken',
      'escalated',
      'resolved',
      'cancelled',
    ]),
    mode: z.enum(CASE_MODES),
    language: languageSchema,

    patientId: z.string().optional(),
    demographics: demographicsSchema,
    emergencyCard: emergencyCardSchema.optional(),
    vitals: z.array(vitalReadingSchema),

    evidence: z.array(evidenceItemSchema),

    risk: riskAssessmentSchema,
    confidence: confidenceStateSchema,
    communication: communicationReadSchema,

    lastTurnId: z.string().optional(),
    turnCount: z.number().int().nonnegative(),

    routing: routingDecisionSchema.optional(),
    dispatch: dispatchStateSchema,
    hospital: hospitalMatchSchema.optional(),
    preArrival: preArrivalSummarySchema.optional(),

    relay: relayStateSchema,
    companion: companionStateSchema,
    escalation: escalationStateSchema,
    degradation: degradationStateSchema,

    notifications: z.array(notificationRecordSchema),
    lastKnownLocation: geoFixSchema.optional(),
    /** Optional: only present once a photo of an injury has been submitted. */
    injury: injuryTrackingSchema.optional(),

    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    closedAt: isoTimestampSchema.optional(),
  })
  .superRefine((state, ctx) => {
    // Cross-field invariants that a per-field schema cannot express. These are
    // the rules that, if violated, mean the agent has lost the plot — better to
    // fail loudly at the boundary than to route someone on a corrupt case.

    if (state.confidence.alertActive && state.routing?.confirmedAt !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['routing', 'confirmedAt'],
        message:
          'A routing decision cannot be confirmed while a confidence alert is active (§5.1).',
      });
    }

    if (state.risk.tier === 'red' && state.routing?.outcome === 'self_care_guidance') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['routing', 'outcome'],
        message: 'Red tier can never route to self-care.',
      });
    }

    if (
      state.routing?.outcome === 'ambulance_dispatch' &&
      state.routing.gate.kind !== 'press_and_hold_3s'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['routing', 'gate', 'kind'],
        message:
          'Ambulance dispatch requires the 3-second press-and-hold gate (§5.2, non-negotiable).',
      });
    }

    if (state.degradation.clinicalScoringDegraded && state.degradation.notice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['degradation', 'notice'],
        message: 'Degraded scoring must carry a user-facing notice (§6).',
      });
    }

    // Supersession must be a consistent, bidirectional link. A one-sided link
    // means an item is still counted as active while something else believes it
    // replaced it — i.e. a stale answer silently reaching the scoring engine.
    // Caught here rather than debugged later from a wrong triage level.
    const byId = new Map(state.evidence.map((e) => [e.id, e]));
    for (const item of state.evidence) {
      if (item.supersededBy !== undefined) {
        const replacement = byId.get(item.supersededBy);
        if (replacement === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence'],
            message: `Evidence ${item.id} is superseded by ${item.supersededBy}, which is not on the record.`,
          });
        } else if (replacement.supersedes !== item.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence'],
            message: `Evidence ${item.id} points to ${item.supersededBy} as its replacement, but that item does not point back.`,
          });
        }
      }
      if (item.supersedes !== undefined) {
        const replaced = byId.get(item.supersedes);
        if (replaced === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence'],
            message: `Evidence ${item.id} supersedes ${item.supersedes}, which is not on the record.`,
          });
        } else if (replaced.supersededBy !== item.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence'],
            message: `Evidence ${item.id} supersedes ${item.supersedes}, but that item is not marked as superseded by it. A one-sided link leaves stale evidence active.`,
          });
        }
      }
    }
  });

export type ParsedCaseState = z.infer<typeof caseStateSchema>;

// --- Timeline / tool calls ---------------------------------------------------

export const timelineEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  provenance: z.enum(['reported', 'tool_output', 'agent_inference', 'system_event']),
  summary: z.string().min(1),
  detail: z.string().optional(),
  quotedText: z.string().optional(),
  riskTierAfter: z.enum(RISK_TIERS).optional(),
  riskTierBefore: z.enum(RISK_TIERS).optional(),
  turnId: z.string().optional(),
  toolCallId: z.string().optional(),
  at: isoTimestampSchema,
  recordedAt: isoTimestampSchema,
});

export const toolCallRecordSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  role: z.string().min(1),
  status: z.enum([
    'started',
    'succeeded',
    'succeeded_degraded',
    'failed',
    'quota_exceeded',
    'timed_out',
  ]),
  turnId: z.string().optional(),
  phase: z.enum(['observe', 'decide', 'act', 'evaluate', 'adapt']),
  argsDigest: z.string(),
  resultDigest: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
  attempts: z.number().int().positive(),
  errorMessage: z.string().optional(),
  degradationNotice: z.string().optional(),
  startedAt: isoTimestampSchema,
  completedAt: isoTimestampSchema.optional(),
});

// --- The demo fixture bundle -------------------------------------------------

/**
 * Everything the six-beat demo needs, in one file. If this schema cannot
 * express the full judged sequence, the model is wrong — which is exactly what
 * `demo-fixture.test.ts` checks.
 */
export const demoFixtureSchema = z.object({
  case: caseStateSchema,
  timeline: z.array(timelineEntrySchema),
  toolCalls: z.array(toolCallRecordSchema),
});

// --- Boundary helpers --------------------------------------------------------

export interface ParseFailure {
  readonly ok: false;
  readonly issues: readonly string[];
}
export type ParseOutcome<T> = { readonly ok: true; readonly value: T } | ParseFailure;

/** Non-throwing parse, for the Firestore read path where a bad doc must degrade, not crash. */
export function parseCaseState(input: unknown): ParseOutcome<ParsedCaseState> {
  const result = caseStateSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        issues: result.error.issues.map(
          (i) => `${i.path.join('.') || '<root>'}: ${i.message}`,
        ),
      };
}
