/**
 * Firebase Admin initialisation. Lazy and memoised — the app must boot and
 * serve requests even with no credentials configured, so nothing here runs
 * unless `config.firebase.enabled` is true.
 */

import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, type Firestore } from 'firebase-admin/firestore';
import type { ServerConfig } from './config.js';

let app: App | undefined;
let firestore: Firestore | undefined;

export function getFirestore(config: ServerConfig): Firestore {
  if (firestore !== undefined) return firestore;

  if (!config.firebase.enabled || config.firebase.credentialsPath === undefined) {
    throw new Error(
      'Firestore requested but no service-account credential is configured. ' +
        'Set GOOGLE_APPLICATION_CREDENTIALS and FIREBASE_PROJECT_ID in the root .env.',
    );
  }

  if (app === undefined) {
    const existing = getApps();
    app =
      existing.length > 0
        ? existing[0]!
        : initializeApp({
            credential: cert(
              JSON.parse(readFileSync(config.firebase.credentialsPath, 'utf8')) as object,
            ),
            ...(config.firebase.projectId !== undefined
              ? { projectId: config.firebase.projectId }
              : {}),
          });
  }

  firestore = getAdminFirestore(app);
  return firestore;
}
