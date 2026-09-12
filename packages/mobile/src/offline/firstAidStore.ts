/**
 * Offline persistence for first-aid content - the React Native replacement for
 * the PWA's service-worker cache (spec 5.8).
 *
 * A service worker intercepts network requests; React Native has no such layer,
 * so the equivalent guarantee is achieved differently: the content is BUNDLED
 * into the app, which makes it available offline by construction, and is then
 * mirrored into AsyncStorage so a future build can refresh it over the air
 * without shipping a new binary.
 *
 * Reads deliberately fall back to the bundled copy on any storage failure.
 * AsyncStorage can genuinely fail (device full, corrupted store), and first-aid
 * instructions are the one screen that must work when everything else has
 * failed - failing closed here would defeat the entire point of the feature.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { FIRST_AID_TOPICS, type FirstAidTopic } from '../data/firstAidContent';

const STORAGE_KEY = 'triage.firstAid.v1';

/** Bump when the bundled content changes so stale cached copies are replaced. */
const CONTENT_VERSION = 1;

interface StoredPayload {
  readonly version: number;
  readonly topics: readonly FirstAidTopic[];
  readonly cachedAt: string;
}

/**
 * Called once at startup. Writes the bundled content into AsyncStorage if it is
 * missing or out of date. Never throws - a failed cache write must not stop the
 * app from starting.
 */
export async function hydrateFirstAidCache(): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY);
    if (existing !== null) {
      const parsed = JSON.parse(existing) as StoredPayload;
      if (parsed.version === CONTENT_VERSION) return;
    }
    const payload: StoredPayload = {
      version: CONTENT_VERSION,
      topics: FIRST_AID_TOPICS,
      cachedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Cache is an optimisation, not the source of truth. Bundled content still
    // works, so a failure here is genuinely not worth surfacing to the user.
  }
}

/**
 * Topics for display. Prefers the cached copy (which may be newer than the
 * bundle after an OTA content update) and falls back to the bundled content.
 */
export async function loadFirstAidTopics(): Promise<readonly FirstAidTopic[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return FIRST_AID_TOPICS;
    const parsed = JSON.parse(raw) as StoredPayload;
    return parsed.topics.length > 0 ? parsed.topics : FIRST_AID_TOPICS;
  } catch {
    return FIRST_AID_TOPICS;
  }
}
