/**
 * Covers the guards the Medicine scanner was missing entirely: an oversized
 * photo used to reach the server, be refused by `express.json`'s 10 MB limit
 * with an HTML body, and surface to the user as "did not return JSON".
 *
 * `FileReader` is a DOM API and these run in vitest's node environment, so
 * the tests below stub it. That is deliberate rather than a workaround — the
 * logic worth pinning is the validation and the failure mapping, not the
 * browser's own base64 encoder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_DATA_URL_CHARS, MAX_IMAGE_BYTES, readImageFile } from './imageInput';

/** Enough of a `File` for the validator: it only reads `type` and `size`. */
function fakeFile(type: string, size: number): File {
  return { type, size } as File;
}

type ReaderOutcome = { readonly result: unknown } | { readonly error: true } | { readonly throws: true };

/** Installs a FileReader whose single read produces `outcome`. */
function stubFileReader(outcome: ReaderOutcome): void {
  class StubReader {
    onload: ((event: { target: { result: unknown } }) => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(): void {
      if ('throws' in outcome) throw new Error('storage blocked');
      queueMicrotask(() => {
        if ('error' in outcome) this.onerror?.();
        else this.onload?.({ target: { result: outcome.result } });
      });
    }
  }
  vi.stubGlobal('FileReader', StubReader);
}

beforeEach(() => {
  stubFileReader({ result: 'data:image/jpeg;base64,AAAA' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readImageFile', () => {
  it('accepts an ordinary photo and returns its data URL', async () => {
    const result = await readImageFile(fakeFile('image/jpeg', 1_200_000));
    expect(result).toEqual({ ok: true, dataUrl: 'data:image/jpeg;base64,AAAA' });
  });

  it('refuses a file that is not an image', async () => {
    const result = await readImageFile(fakeFile('application/pdf', 1_000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not an image/i);
  });

  it('refuses an oversized photo before spending time encoding it', async () => {
    // The point of the byte check: the reader must never even be asked.
    stubFileReader({ throws: true });
    const result = await readImageFile(fakeFile('image/jpeg', MAX_IMAGE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/too large/i);
  });

  it('states the actual size so the message is actionable', async () => {
    const result = await readImageFile(fakeFile('image/jpeg', 9_200_000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('9.2 MB');
  });

  it('refuses an encoded string over the server limit even when the byte size passed', async () => {
    // base64 costs 4 chars per 3 bytes and the data: prefix rides on top, so
    // a file just under the byte cap can still encode past the server's
    // character cap. This is the gap the byte check alone cannot close.
    stubFileReader({ result: `data:image/jpeg;base64,${'A'.repeat(MAX_DATA_URL_CHARS)}` });
    const result = await readImageFile(fakeFile('image/jpeg', MAX_IMAGE_BYTES - 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/too large/i);
  });

  it('reports a read failure instead of resolving with nothing', async () => {
    stubFileReader({ error: true });
    const result = await readImageFile(fakeFile('image/png', 500_000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/could not be read/i);
  });

  it('reports a non-string reader result rather than sending it', async () => {
    stubFileReader({ result: new ArrayBuffer(8) });
    const result = await readImageFile(fakeFile('image/png', 500_000));
    expect(result.ok).toBe(false);
  });

  it('never rejects, so a caller cannot leave the UI stuck mid-read', async () => {
    stubFileReader({ throws: true });
    await expect(readImageFile(fakeFile('image/png', 100))).resolves.toMatchObject({ ok: false });
  });

  it('keeps its limits consistent with the server contract', () => {
    // These mirror express.json({ limit: '10mb' }) and the photoRef zod max.
    expect(MAX_DATA_URL_CHARS).toBe(8_000_000);
    expect(MAX_IMAGE_BYTES).toBeLessThan(10_000_000);
  });
});
