/**
 * The registry only helps if it stays complete. This test is the mechanism
 * that keeps it so: it scans the web source for every `vitalis.*` key
 * literal and fails if one is missing from `VITALIS_STORAGE_KEYS`.
 *
 * It exists because the list it replaced HAD drifted — Settings' "remove all
 * data stored on this device" omitted `vitalis.ownerUid`, the identifier tying
 * the browser to its cases, so the control did not do what it told the user
 * it did. A hand-maintained copy of a list will drift again; this makes the
 * drift a failing test instead of a silent privacy hole.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VITALIS_STORAGE_KEYS } from './storageKeys';

const SRC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

/** Every `'vitalis.…'` string literal written anywhere in packages/web/src. */
function keysUsedInSource(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/['"`](vitalis\.[A-Za-z0-9._]+)['"`]/g)) {
      found.add(match[1] as string);
    }
  }
  return found;
}

describe('VITALIS_STORAGE_KEYS', () => {
  it('lists every vitalis.* key the source actually writes', () => {
    const used = [...keysUsedInSource()].sort();
    const registered: readonly string[] = [...VITALIS_STORAGE_KEYS].sort();
    expect(used.filter((k) => !registered.includes(k))).toEqual([]);
  });

  it('does not list keys nothing uses any more', () => {
    const used = keysUsedInSource();
    expect(VITALIS_STORAGE_KEYS.filter((k: string) => !used.has(k))).toEqual([]);
  });

  it('includes the anonymous device id, which clear-data previously left behind', () => {
    // Named explicitly rather than left to the scan above: this is the key
    // whose absence was the actual bug, and it is the one that matters most.
    expect(VITALIS_STORAGE_KEYS).toContain('vitalis.ownerUid');
  });

  it('has no duplicates', () => {
    expect(new Set(VITALIS_STORAGE_KEYS).size).toBe(VITALIS_STORAGE_KEYS.length);
  });
});
