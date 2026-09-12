/**
 * Resolves the owner uid sent with every new case.
 *
 * `CaseState.ownerUid` is what firebase/firestore.rules matches on, so this
 * value decides whether the case the server writes is readable by this device
 * at all. Getting it right matters more than it looks.
 *
 * Order of preference:
 *  1. The Firebase Auth anonymous uid. This is the only value that satisfies
 *     the security rules, because the rules compare against `request.auth.uid`.
 *  2. A locally generated, persisted device id, used only when Firebase is not
 *     configured or sign-in failed. It will NOT satisfy the rules — but in that
 *     situation there is no live Firestore listener either, so the app is
 *     already running on POST acknowledgements alone. The fallback exists so
 *     the server's required-field contract can stay strict rather than being
 *     loosened to accommodate an unconfigured client.
 *
 * The uid is cached for the process lifetime: anonymous sign-in is a network
 * round trip, and the Emergency screen calls this on mount, which is the worst
 * possible moment to wait on one twice.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { currentUid, ensureSignedIn, isFirebaseConfigured } from './firebase/client';

const DEVICE_ID_KEY = 'triage.deviceId.v1';

let cached: string | undefined;

function newLocalId(): string {
  // Not a security token - it only has to be stable per install and unlikely
  // to collide, so Math.random is adequate and avoids a crypto polyfill.
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function localDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing !== null && existing.length > 0) return existing;
    const fresh = newLocalId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // AsyncStorage unavailable: an in-memory id still lets the case be created,
    // it just will not survive a reload.
    return newLocalId();
  }
}

export async function resolveOwnerUid(): Promise<string> {
  if (cached !== undefined) return cached;

  if (isFirebaseConfigured()) {
    const signedIn = await ensureSignedIn();
    const uid = signedIn ? currentUid() : undefined;
    if (uid !== undefined && uid.length > 0) {
      cached = uid;
      return uid;
    }
  }

  cached = await localDeviceId();
  return cached;
}

/**
 * True when the uid in use is a real Auth uid, so the case will actually be
 * readable through the Firestore listener. The UI uses this to explain a
 * missing live feed instead of just showing nothing.
 */
export function hasAuthenticatedUid(): boolean {
  return cached !== undefined && !cached.startsWith('local_');
}
