/**
 * Minimal, always-succeeding stand-ins for the ports the orchestrator tests
 * exercise only incidentally (hospital matching, notifications, knowledge
 * lookup, medication normalisation, condition coding). Each returns one
 * fixed, valid, schema-shaped value — enough to test that the loop calls them
 * at the right moment, not what they say.
 */

import type {
  CodingPort,
  Explanation,
  Hospital,
  HospitalPort,
  KnowledgePort,
  MedicationPort,
  NormalizedMedication,
  NotificationPort,
  PreArrivalSummary,
  ToolResult,
} from '@triage/shared';
import { liveResult } from '@triage/shared';

export class MockKnowledgePort implements KnowledgePort {
  async explain(concept: { readonly name: string }): Promise<ToolResult<Explanation>> {
    return liveResult(
      {
        text: `${concept.name} is a symptom worth discussing with a clinician.`,
        citation: {
          provider: 'medlineplus',
          title: `MedlinePlus: ${concept.name}`,
          retrievedAt: new Date().toISOString(),
        },
      },
      1,
    );
  }
}

export class MockMedicationPort implements MedicationPort {
  async normalize(
    reportedNames: readonly string[],
  ): Promise<ToolResult<readonly NormalizedMedication[]>> {
    return liveResult(
      reportedNames.map((reportedName) => ({ reportedName, interactionFlags: [] })),
      1,
    );
  }
}

export class MockCodingPort implements CodingPort {
  async codeForCategory(): Promise<
    ToolResult<{ readonly code: string; readonly title: string; readonly uri?: string }>
  > {
    return liveResult({ code: 'MD30.0', title: 'Chest pain' }, 1);
  }
}

const MOCK_HOSPITAL: Hospital = {
  osmId: 'node/1',
  name: 'Mock General Hospital',
  location: { lat: 20.2961, lng: 85.8245 },
  specialties: ['emergency', 'cardiology'],
  bedAvailability: {
    simulated: true,
    emergencyBedsFree: 3,
    icuBedsFree: 1,
    totalEmergencyBeds: 20,
    lastUpdated: new Date().toISOString(),
  },
  hasEmergencyDepartment: true,
  dataProvenance: { location: 'fixture', specialties: 'simulated', bedAvailability: 'simulated' },
};

export class MockHospitalPort implements HospitalPort {
  async findNearby(): Promise<ToolResult<readonly Hospital[]>> {
    return liveResult([MOCK_HOSPITAL], 1);
  }

  async pushPreArrival(input: {
    readonly caseId: string;
    readonly osmId: string;
  }): Promise<ToolResult<PreArrivalSummary>> {
    return liveResult(
      {
        caseId: input.caseId,
        sentAt: new Date().toISOString(),
        destinationOsmId: input.osmId,
        simulated: true,
        acknowledged: true,
      },
      1,
    );
  }
}

export class MockNotificationPort implements NotificationPort {
  async send(): Promise<ToolResult<{ readonly providerMessageId: string }>> {
    return liveResult({ providerMessageId: 'mock-message-1' }, 1);
  }
}
