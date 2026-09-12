/**
 * Stand-in patient profile for the Emergency Card screen (5.6).
 *
 * ROUGH-SCREEN SCAFFOLDING. There is no profile editor and no `patients/{id}`
 * document being written yet, so this fills the screen with realistic content
 * so the layout can be judged. It is typed as the real `EmergencyCard`, so
 * replacing it with a Firestore read is a one-line change at the call site and
 * the screen does not move.
 */

import type { EmergencyCard, PatientDemographics } from '@triage/shared';

export const DEMO_DEMOGRAPHICS: PatientDemographics = {
  ageYears: 52,
  sex: 'male',
  displayName: 'Ravi Kumar',
  preferredLanguage: 'en',
  isMinor: false,
};

export const DEMO_EMERGENCY_CARD: EmergencyCard = {
  bloodGroup: 'B+',
  allergies: ['Penicillin', 'Sulfa drugs'],
  medications: [
    { reportedName: 'Metformin 500mg', normalizedName: 'metformin', rxcui: '6809' },
    { reportedName: 'Telmisartan 40mg', normalizedName: 'telmisartan', rxcui: '73494' },
  ],
  chronicConditions: ['Type 2 diabetes', 'Hypertension'],
  organDonor: true,
  notes: 'Lives alone. Spare key with neighbour in Flat 3B.',
  updatedAt: '2026-09-10T18:30:00.000Z',
};

export interface EmergencyContact {
  readonly name: string;
  readonly relationship: string;
  readonly phone: string;
  readonly isPrimary: boolean;
}

export const DEMO_CONTACTS: readonly EmergencyContact[] = [
  { name: 'Priya Kumar', relationship: 'Daughter', phone: '+919876543210', isPrimary: true },
  { name: 'Dr. S. Menon', relationship: 'GP', phone: '+919812345678', isPrimary: false },
];
