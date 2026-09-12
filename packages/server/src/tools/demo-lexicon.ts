/**
 * Keyword lexicon for the stand-in normalisation port.
 *
 * This is what stands in for Infermedica `/parse` until
 * INFERMEDICA_APP_ID/APP_KEY arrive. It maps literal phrases onto concept ids,
 * which is enough to drive a real interview through the loop but is emphatically
 * NOT natural-language understanding — "no chest pain at all" and "chest pain"
 * both match the same entry unless a negated phrase is listed explicitly.
 *
 * Concept ids are the same PLACEHOLDERS used in `quick-select.ts` and the demo
 * fixture, still unreconciled against a live `/search` response (see the
 * README's open item). They are internally consistent, which is what the loop
 * needs; they are not claimed to be the real Infermedica ids.
 */

import type { LexiconEntry } from '@triage/agent';

export const DEMO_LEXICON: readonly LexiconEntry[] = [
  // --- Negations first: order does not matter to the matcher (it collects all
  // matches), so negated phrases must be distinct strings that do not appear
  // inside their positive counterparts.
  { match: 'not sweating', id: 's_47', type: 'symptom', name: 'Excessive sweating', commonName: 'sweating', choiceId: 'absent' },
  { match: 'no chest pain', id: 's_21', type: 'symptom', name: 'Chest pain', commonName: 'chest pain', choiceId: 'absent' },
  { match: 'breathing is fine', id: 's_13', type: 'symptom', name: 'Dyspnea', commonName: 'shortness of breath', choiceId: 'absent' },
  { match: 'not dizzy', id: 's_15', type: 'symptom', name: 'Dizziness', commonName: 'dizziness', choiceId: 'absent' },

  // --- Chest pain and cardiac-adjacent presentations
  { match: 'chest pain', id: 's_21', type: 'symptom', name: 'Chest pain', commonName: 'chest pain', choiceId: 'present' },
  { match: 'pain in my chest', id: 's_21', type: 'symptom', name: 'Chest pain', commonName: 'chest pain', choiceId: 'present' },
  { match: 'heavy feeling in my chest', id: 's_21', type: 'symptom', name: 'Chest pain', commonName: 'chest pain', choiceId: 'present' },
  { match: 'tightness in my chest', id: 's_21', type: 'symptom', name: 'Chest pain', commonName: 'chest pain', choiceId: 'present' },
  { match: 'left arm', id: 's_98', type: 'symptom', name: 'Pain radiating to the left arm', commonName: 'pain spreading to the left arm', choiceId: 'present' },
  { match: 'down my arm', id: 's_98', type: 'symptom', name: 'Pain radiating to the left arm', commonName: 'pain spreading to the left arm', choiceId: 'present' },
  { match: 'jaw', id: 's_112', type: 'symptom', name: 'Jaw pain', commonName: 'jaw pain', choiceId: 'present' },

  // --- Breathing
  { match: "can't breathe", id: 's_13', type: 'symptom', name: 'Dyspnea', commonName: 'shortness of breath', choiceId: 'present' },
  { match: 'cant breathe', id: 's_13', type: 'symptom', name: 'Dyspnea', commonName: 'shortness of breath', choiceId: 'present' },
  { match: 'short of breath', id: 's_13', type: 'symptom', name: 'Dyspnea', commonName: 'shortness of breath', choiceId: 'present' },
  { match: 'hard to breathe', id: 's_13', type: 'symptom', name: 'Dyspnea', commonName: 'shortness of breath', choiceId: 'present' },

  // --- General
  { match: 'sweating', id: 's_47', type: 'symptom', name: 'Excessive sweating', commonName: 'sweating', choiceId: 'present' },
  { match: 'drenched in sweat', id: 's_47', type: 'symptom', name: 'Excessive sweating', commonName: 'sweating', choiceId: 'present' },
  { match: 'dizzy', id: 's_15', type: 'symptom', name: 'Dizziness', commonName: 'dizziness', choiceId: 'present' },
  { match: 'lightheaded', id: 's_15', type: 'symptom', name: 'Dizziness', commonName: 'dizziness', choiceId: 'present' },
  { match: 'vomit', id: 's_16', type: 'symptom', name: 'Vomiting', commonName: 'vomiting', choiceId: 'present' },
  { match: 'nausea', id: 's_17', type: 'symptom', name: 'Nausea', commonName: 'feeling sick', choiceId: 'present' },
  { match: 'headache', id: 's_1193', type: 'symptom', name: 'Headache', commonName: 'headache', choiceId: 'present' },
  { match: 'bleeding', id: 's_1148', type: 'symptom', name: 'Bleeding', commonName: 'bleeding', choiceId: 'present' },
  { match: 'fainted', id: 's_205', type: 'symptom', name: 'Loss of consciousness', commonName: 'fainting', choiceId: 'present' },
  { match: 'passed out', id: 's_205', type: 'symptom', name: 'Loss of consciousness', commonName: 'fainting', choiceId: 'present' },
  { match: 'abdominal pain', id: 's_99', type: 'symptom', name: 'Abdominal pain', commonName: 'stomach pain', choiceId: 'present' },
  { match: 'stomach pain', id: 's_99', type: 'symptom', name: 'Abdominal pain', commonName: 'stomach pain', choiceId: 'present' },

  // --- Risk factors
  { match: 'smoke', id: 'p_8', type: 'risk_factor', name: 'Smoking', commonName: 'smoking', choiceId: 'present' },
  { match: 'diabetes', id: 'p_10', type: 'risk_factor', name: 'Diabetes', commonName: 'diabetes', choiceId: 'present' },
  { match: 'high blood pressure', id: 'p_9', type: 'risk_factor', name: 'Hypertension', commonName: 'high blood pressure', choiceId: 'present' },
];
