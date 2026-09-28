/**
 * THE ONE ROUTE OUT OF THE PHOTO CACHE, and the only one there will be.
 *
 * The on-device plate-photo cache is its own IndexedDB database
 * (`local-store/store.ts`'s `PHOTOS_DB_NAME`), deliberately outside the backup
 * allowlist (`local-store/backup.ts`'s `readSnapshot`) and therefore outside
 * the encrypted sync payload, which reads through the same allowlist. That
 * isolation was built on purpose and this module does not weaken it:
 *
 *  - {@link exportPhotoForFeedback} is the ONLY export here, it takes one
 *    entry's batch id, and it exists for one caller
 *    (`local-store/feedback-outbox.ts`'s enqueue path).
 *  - There is NO general "give me the photo bytes" helper, and none may be
 *    added. The backup and sync modules must stay unable to reach this
 *    database, and a convenience function here is precisely how that would
 *    stop being true without anybody deciding it.
 *  - The allowlist is UNCHANGED by this feature. No new entity reaches a
 *    backup file or a sync blob.
 *
 * IT RETURNS `null` RATHER THAN THROWING, always. The cache evicts by age and
 * by count (`local-store/photo-policy.ts`), so the image can be gone before
 * the person presses the button, and a person in that position must still be
 * able to report the figures. Every failure below, including a database that
 * will not open, is the same answer: no image, not an error.
 */
import { base64ToBytes } from '#app/lib/sync/engine/crypto/base64';
import { getPhotoDataUrl } from '#app/lib/local-store/photos';
import { downscaleToJpeg } from '#app/lib/photo-constraints';
import { ALLOWED_FEEDBACK_IMAGE_TYPES, MAX_FEEDBACK_IMAGE_BYTES } from './feedback-report';

/** A parsed `data:` URL. Exported for the test that drives the parser against malformed input. */
export interface ParsedPhotoDataUrl {
  contentType: string;
  base64: string;
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/;

/**
 * Splits a base64 `data:` URL into its type and its payload, or `null`.
 *
 * The cache stores what `savePlatePhoto` wrote, which is always this shape.
 * Parsing it rather than slicing at a fixed offset is what makes a row written
 * by some future build, or by hand in devtools, a clean miss instead of a
 * corrupt upload.
 */
export function parsePhotoDataUrl(dataUrl: string): ParsedPhotoDataUrl | null {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (match === null) return null;
  const contentType = match[1]?.trim().toLowerCase() ?? '';
  const base64 = match[2] ?? '';
  if (contentType.length === 0 || base64.length === 0) return null;
  return { contentType, base64 };
}

/** The seam's injectable edges, so the test drives it without IndexedDB and without a canvas. */
export interface ExportPhotoForFeedbackInput {
  userId: number;
  /** `null` for an entry that never came from a scan: typed by hand, or added from search. */
  logBatchId: string | null;
  readDataUrl?: (keyParts: { userId: number; logBatchId: string }) => Promise<string | null>;
  downscale?: (file: File) => Promise<File>;
}

/**
 * This entry's cached photograph, capped to something the server will store,
 * or `null` when there is none.
 *
 * THE CAP IS APPLIED BEFORE THE IMAGE ENTERS THE QUEUE, and it re-uses
 * `photo-constraints.ts`'s `downscaleToJpeg` rather than a second downscaler:
 * one canvas re-encode in this app, one set of dimension and quality
 * constants, and one place that has to keep being true about stripping camera
 * metadata. An oversized photograph that cannot be brought under the cap is a
 * report with no image, never a report that sits in the outbox being refused.
 */
export async function exportPhotoForFeedback({
  userId,
  logBatchId,
  readDataUrl = getPhotoDataUrl,
  downscale = downscaleToJpeg,
}: ExportPhotoForFeedbackInput): Promise<Blob | null> {
  if (logBatchId === null) return null;

  try {
    const dataUrl = await readDataUrl({ userId, logBatchId });
    if (dataUrl === null) return null;

    const parsed = parsePhotoDataUrl(dataUrl);
    if (parsed === null) return null;

    const bytes = base64ToBytes(parsed.base64);
    if (bytes.byteLength === 0) return null;

    // SAFETY: `bytes.buffer` is typed `ArrayBufferLike` because a `Uint8Array`
    // could in principle sit on a `SharedArrayBuffer`, which `BlobPart`
    // refuses. `base64ToBytes` allocates with `new Uint8Array(length)` and
    // `.slice()` copies again, so this buffer is a plain `ArrayBuffer` this
    // function created and nothing else holds.
    const buffer = bytes.slice().buffer as ArrayBuffer;
    const original = new Blob([buffer], { type: parsed.contentType });
    if (ALLOWED_FEEDBACK_IMAGE_TYPES.includes(parsed.contentType) && original.size <= MAX_FEEDBACK_IMAGE_BYTES) {
      return original;
    }

    // Either a type the server refuses or bytes above its cap. One re-encode
    // answers both, and a browser that cannot decode the image throws out of
    // `downscaleToJpeg` into the catch below, where it becomes "no image".
    const reduced = await downscale(new File([original], 'plate.jpg', { type: parsed.contentType }));
    return reduced.size <= MAX_FEEDBACK_IMAGE_BYTES ? reduced : null;
  } catch {
    // An evicted image, a database that will not open, a browser with no
    // canvas. None of them is a reason a person cannot report a wrong figure.
    return null;
  }
}
