/**
 * The ONE place a user-chosen image file becomes a `data:` URL for the
 * backend — shared by the Assistant composer's camera button and the
 * Medicine scanner, which were previously validating this independently:
 * the Assistant checked the type, the size and the read error, while the
 * Medicine scanner checked none of the three. A 9 MB photo picked there
 * sailed past the browser, past `express.json({ limit: '10mb' })` as a 413
 * with an HTML body, and surfaced as "did not return JSON" — an error about
 * the wrong thing entirely, with nothing the user could act on.
 *
 * The limits below are not independent guesses; they mirror the server:
 *   - `express.json({ limit: '10mb' })`             — app.ts
 *   - `photoRef: z.string().max(8_000_000)`         — routes/{assistant,medications,cases}.ts
 *
 * The BYTE budget is checked first so an obviously-too-big file is rejected
 * before spending time base64-encoding it, and the encoded LENGTH is checked
 * afterwards because the byte figure alone cannot prove it: base64 costs
 * 4 chars per 3 bytes and the `data:image/jpeg;base64,` prefix rides on top,
 * so a file just under the byte cap can still land just over the server's
 * character cap. Checking the real string closes that gap exactly.
 */

/** Phone cameras routinely produce 4–8 MB JPEGs; base64 adds ~33% on top. */
export const MAX_IMAGE_BYTES = 6_000_000;

/** Must stay equal to the server's `photoRef` zod maximum. */
export const MAX_DATA_URL_CHARS = 8_000_000;

export type ImageReadResult = { readonly ok: true; readonly dataUrl: string } | { readonly ok: false; readonly message: string };

const TOO_BIG = (bytes: number) =>
  `That photo is ${(bytes / 1_000_000).toFixed(1)} MB, which is too large to send. Try a smaller photo, or your camera's lower-resolution setting.`;

const UNREADABLE = 'That photo could not be read from your device. Try another one.';

/**
 * Resolves with the data URL, or with a message that is safe to show as-is.
 * Never rejects — every failure is a returned `{ ok: false }` so callers
 * cannot forget a `.catch` and leave the UI stuck mid-read.
 */
export function readImageFile(file: File): Promise<ImageReadResult> {
  if (!file.type.startsWith('image/')) {
    return Promise.resolve({ ok: false, message: 'That file is not an image. Choose a JPG or PNG photo.' });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.resolve({ ok: false, message: TOO_BIG(file.size) });
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = typeof event.target?.result === 'string' ? event.target.result : undefined;
      if (dataUrl === undefined) {
        resolve({ ok: false, message: UNREADABLE });
        return;
      }
      if (dataUrl.length > MAX_DATA_URL_CHARS) {
        resolve({ ok: false, message: TOO_BIG(file.size) });
        return;
      }
      resolve({ ok: true, dataUrl });
    };
    reader.onerror = () => resolve({ ok: false, message: UNREADABLE });
    try {
      reader.readAsDataURL(file);
    } catch {
      resolve({ ok: false, message: UNREADABLE });
    }
  });
}
