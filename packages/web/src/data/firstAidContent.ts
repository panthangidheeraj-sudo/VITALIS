/**
 * Ported verbatim from packages/mobile/src/data/firstAidContent.ts. Static
 * reference text — never calls a tool, never produces a risk tier. See the
 * mobile file for sourcing notes (condensed from standard AHA/ERC lay-CPR
 * guidance, not independently clinically reviewed for this project).
 */

export interface FirstAidStep {
  readonly n: number;
  readonly text: string;
}

export interface FirstAidTopic {
  readonly id: string;
  readonly title: string;
  readonly whenToUse: string;
  readonly steps: readonly FirstAidStep[];
  readonly callEmergencyFirst: boolean;
}

export const FIRST_AID_DISCLAIMER =
  'General guidance only, for use while waiting for help. Not a substitute for ' +
  'emergency services or a clinician. If you are unsure, call for help first.';

export const EMERGENCY_NUMBER = '108';

export const FIRST_AID_TOPICS: readonly FirstAidTopic[] = [
  {
    id: 'cpr',
    title: 'CPR',
    whenToUse: 'Person is unresponsive and not breathing normally.',
    callEmergencyFirst: true,
    steps: [
      { n: 1, text: `Call ${EMERGENCY_NUMBER} now, or have someone else call while you start.` },
      { n: 2, text: 'Lay the person flat on their back on a firm surface.' },
      { n: 3, text: 'Place the heel of one hand in the centre of the chest, other hand on top.' },
      { n: 4, text: 'Push hard and fast — about 5–6 cm deep, 100–120 compressions per minute.' },
      { n: 5, text: 'Let the chest rise fully between compressions.' },
      { n: 6, text: 'Do not stop until help arrives or the person starts breathing normally.' },
    ],
  },
  {
    id: 'choking',
    title: 'Choking',
    whenToUse: 'Person cannot speak, cough or breathe.',
    callEmergencyFirst: true,
    steps: [
      { n: 1, text: 'Ask "Are you choking?" If they can cough forcefully, let them keep coughing.' },
      { n: 2, text: 'If they cannot cough or speak, give 5 firm back blows between the shoulder blades.' },
      { n: 3, text: 'Then give 5 abdominal thrusts — fist above the navel, pull sharply inward and up.' },
      { n: 4, text: 'Alternate 5 back blows and 5 thrusts until the object clears.' },
      { n: 5, text: `If they become unresponsive, call ${EMERGENCY_NUMBER} and start CPR.` },
    ],
  },
  {
    id: 'bleeding',
    title: 'Severe bleeding',
    whenToUse: 'Bleeding is heavy, spurting, or will not stop.',
    callEmergencyFirst: true,
    steps: [
      { n: 1, text: `Call ${EMERGENCY_NUMBER}.` },
      { n: 2, text: 'Press firmly and directly on the wound with a clean cloth or your hands.' },
      { n: 3, text: 'Keep pressing — do not lift to check. Add more cloth on top if it soaks through.' },
      { n: 4, text: 'If possible, raise the injured part above heart level.' },
      { n: 5, text: 'Keep the person warm and lying down until help arrives.' },
    ],
  },
  {
    id: 'burns',
    title: 'Burns',
    whenToUse: 'Skin has been burned by heat, steam or chemicals.',
    callEmergencyFirst: false,
    steps: [
      { n: 1, text: 'Move away from the source of the burn.' },
      { n: 2, text: 'Cool the burn under cool (not ice-cold) running water for at least 20 minutes.' },
      { n: 3, text: 'Remove rings or tight clothing near the burn before swelling starts.' },
      { n: 4, text: 'Do not apply ice, butter, oil or toothpaste.' },
      { n: 5, text: 'Cover loosely with cling film or a clean, non-fluffy cloth.' },
      { n: 6, text: `Call ${EMERGENCY_NUMBER} if the burn is large, deep, or on the face, hands or genitals.` },
    ],
  },
];
