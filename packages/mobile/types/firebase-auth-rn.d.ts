/**
 * Type augmentation for a real gap in @firebase/auth's published typings.
 *
 * THE PROBLEM (verified against firebase 12.19.0, not guessed):
 * `getReactNativePersistence` exists at runtime — it is exported from the
 * React Native build at `@firebase/auth/dist/rn/index.js`, and its own
 * `index.rn.d.ts` declares it. But the package's `exports` map is ordered:
 *
 *   "." : {
 *     "types":        "./dist/auth-public.d.ts",   <-- matched first
 *     "node":         { ... },
 *     "react-native": { "types": "./dist/rn/index.rn.d.ts", ... },
 *     ...
 *   }
 *
 * Export conditions are matched IN ORDER, so the top-level `"types"` key wins
 * before the `"react-native"` branch is ever considered. Expo's tsconfig
 * already sets `customConditions: ["react-native"]`, but that cannot help —
 * the issue is ordering, not which conditions are active. The result is a
 * symbol that resolves and runs correctly under Metro while TypeScript insists
 * it does not exist.
 *
 * This augmentation states the signature that the RN build already ships.
 * It adds no runtime behaviour and asserts nothing that is not already true;
 * delete it if Firebase reorders those keys upstream.
 */

// This top-level export is load-bearing: without it the file is a global
// script, and `declare module` below would DECLARE a new ambient module that
// shadows the real one (breaking every other @firebase/auth export) instead of
// augmenting it. With it, the file is a module and the block is an
// augmentation, which is what is intended.
export {};

declare module '@firebase/auth' {
  import type { Persistence } from '@firebase/auth';

  /**
   * Storage shape expected by the RN persistence adapter — structurally what
   * `@react-native-async-storage/async-storage` provides.
   */
  export interface ReactNativeAsyncStorage {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  }

  export function getReactNativePersistence(
    storage: ReactNativeAsyncStorage,
  ): Persistence;
}
