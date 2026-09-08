/**
 * Single source of truth for plate-photo upload constraints, shared by the
 * server action (byte/MIME allowlist enforcement) and the client (instant
 * validation + client-side downscale before upload). Keeping the limits here
 * means the browser and the server can never drift out of agreement.
 *
 * The validation half (`validatePhoto`, `computeScaledDimensions`,
 * `toJpegFilename`) is pure and unit-tested. The `downscaleToJpeg` transcoder
 * uses browser-only APIs (`createImageBitmap`, `<canvas>`) inside its body, so
 * the module stays importable server-side — the function is simply never called
 * there.
 */

/** Hard upload ceiling: 8 MB. Enforced identically on client and server. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Accepted upload MIME types. Typed as `string[]` so `.includes(file.type)` narrows cleanly. */
export const ALLOWED_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/** Longest edge (px) the client downscales to before upload — smaller = faster + cheaper. */
export const MAX_IMAGE_DIMENSION = 1600;
/** JPEG quality for the client-side transcode (0..1). */
export const JPEG_QUALITY = 0.85;

/**
 * Result of validating a candidate photo. Discriminated on `valid` so the
 * failure branch narrows `error` to a non-null string at the call site.
 */
export type PhotoValidationResult = { valid: true } | { valid: false; error: string };

/**
 * The translator this module needs, taken as a parameter rather than imported.
 * A pure module must not reach for the i18next singleton: on the server that
 * singleton is shared by every concurrent request (see `I18nProvider`), so a
 * module-level `t` would render one visitor's language into another's markup.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * Validates a photo's size and MIME type against the shared constraints. Pure —
 * takes just the two fields it needs so it can run on a `File` (client) or a
 * parsed upload (server) without depending on the DOM.
 *
 * @param file - the candidate's byte size and MIME type.
 * @param t - translator for the rejection copy (see `Translate`).
 * @returns whether it may be uploaded, with a reason when it may not.
 */
export function validatePhoto(file: { type: string; size: number }, t: Translate): PhotoValidationResult {
  if (file.size === 0) return { valid: false, error: t('scan.errors.photo.empty') };
  if (file.size > MAX_PHOTO_BYTES) return { valid: false, error: t('scan.errors.photo.tooLarge') };
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: t('scan.errors.photo.unsupportedType') };
  }
  return { valid: true };
}

/** Pixel dimensions of a photo. */
export interface PhotoDimensions {
  width: number;
  height: number;
}

/** A photo's dimensions plus the longest edge it must fit within. */
export interface ScaleToFitInput extends PhotoDimensions {
  maxDimension: number;
}

/**
 * Computes target dimensions that fit within `maxDimension` on the longest edge
 * while preserving aspect ratio. Never upscales. Pure.
 *
 * @returns the scaled width/height (unchanged when already within bounds).
 */
export function computeScaledDimensions({ width, height, maxDimension }: ScaleToFitInput): PhotoDimensions {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxDimension) return { width, height };
  const scale = maxDimension / longestEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Rewrites a filename's extension to `.jpg` (used after the client transcode). Pure. */
export function toJpegFilename(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '');
  return `${base || 'photo'}.jpg`;
}

/** Encodes a canvas to a JPEG blob, rejecting if the browser can't produce one. */
function _canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode image to JPEG.'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Downscales and transcodes an image `File` to a JPEG no larger than
 * `MAX_IMAGE_DIMENSION` on its longest edge. Browser-only (uses
 * `createImageBitmap` + `<canvas>`); throws when the browser can't decode the
 * input (e.g. HEIC outside Safari) so the caller can fall back to the original.
 *
 * @param file - the picked image file.
 * @param options - optional overrides for the max dimension and JPEG quality.
 * @returns a new JPEG `File` ready to upload.
 * @throws when the image can't be decoded or the canvas context is unavailable.
 */
export async function downscaleToJpeg(
  file: File,
  options: { maxDimension?: number; quality?: number } = {},
): Promise<File> {
  const maxDimension = options.maxDimension ?? MAX_IMAGE_DIMENSION;
  const quality = options.quality ?? JPEG_QUALITY;
  const bitmap = await createImageBitmap(file);
  try {
    const dimensions = computeScaledDimensions({ width: bitmap.width, height: bitmap.height, maxDimension });
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const blob = await _canvasToJpegBlob(canvas, quality);
    return new File([blob], toJpegFilename(file.name), { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
