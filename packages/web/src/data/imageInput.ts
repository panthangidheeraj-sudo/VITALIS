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
/**
 * Longest edge sent to the server. Gemini bills an image by how many tiles it
 * covers, so a 4000x3000 phone photo costs several times what a 1280px one
 * does for the same legible label — and it is also several MB to push over a
 * mobile connection, which is the likelier cause of the scanner's "could not
 * be read right now" (a timeout, not an unreadable photo). Label text is
 * large relative to the frame, so 1280px loses nothing a human could read.
 */
const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 0.82;
/** Originals this big are fine once shrunk; the 6MB cap only guards the raw path. */
const MAX_SOURCE_BYTES = 30_000_000;

async function downscaleToJpeg(file: File): Promise<string> {
  // createImageBitmap applies the photo's EXIF rotation, so a sideways phone
  // shot arrives upright instead of being sent sideways.
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

export async function readImageFile(file: File): Promise<ImageReadResult> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, message: 'That file is not an image. Choose a JPG or PNG photo.' };
  }
  const canDownscale = typeof createImageBitmap === 'function' && typeof document !== 'undefined';
  if (file.size > (canDownscale ? MAX_SOURCE_BYTES : MAX_IMAGE_BYTES)) {
    return { ok: false, message: TOO_BIG(file.size) };
  }
  if (canDownscale) {
    try {
      const shrunk = await downscaleToJpeg(file);
      if (shrunk.length <= MAX_DATA_URL_CHARS) return { ok: true, dataUrl: shrunk };
    } catch {
      // Undecodable here (an exotic format, no canvas): fall through to the
      // plain read below rather than failing a photo the server could take.
    }
  }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, message: TOO_BIG(file.size) };

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
