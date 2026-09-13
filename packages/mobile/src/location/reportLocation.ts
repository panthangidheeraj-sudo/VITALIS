/**
 * Reports the device's position to the orchestrator, once, for hospital
 * matching (5.3).
 *
 * ---------------------------------------------------------------------------
 * THIS IS BEST-EFFORT AND MUST NEVER BLOCK THE EMERGENCY FLOW.
 *
 * Every failure path here - permission refused, GPS cold, location services
 * off, the request timing out - resolves to `false` and nothing else happens.
 * The case simply carries no location, hospital matching is skipped, and the
 * patient is told which KIND of facility to go to rather than which one. That
 * is a real degradation and it is enormously better than a permission dialog
 * standing between someone and an ambulance.
 *
 * `Balanced` accuracy, not `Highest`: a high-accuracy fix can take fifteen
 * seconds outdoors and never resolve indoors, and hospital matching does not
 * need metre precision - it needs to know which city district you are in.
 * ---------------------------------------------------------------------------
 *
 * Called once per case rather than subscribed continuously. A live location
 * stream is a tracking feature; this answers one question ("which hospital is
 * nearest?") at one moment, and the answer is not improved by following
 * someone around.
 */

import type { CaseId } from '@triage/shared';
import { api } from '../api/client';

export async function reportLocationOnce(caseId: CaseId): Promise<boolean> {
  try {
    // Required lazily so a device without the module - or a web preview - does
    // not take the whole screen down at import time.
    const Location = await import('expo-location');

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return false;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    await api.reportLocation(caseId, position.coords.latitude, position.coords.longitude);
    return true;
  } catch {
    // Deliberately silent to the user. There is nothing they can usefully do
    // about it mid-emergency, and an error toast during a chest-pain interview
    // is noise at the worst possible time. The absence of a matched hospital
    // on the tracking screen is the honest, visible consequence.
    return false;
  }
}
