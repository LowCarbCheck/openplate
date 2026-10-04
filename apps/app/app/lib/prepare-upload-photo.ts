/**
 * THE ONE STEP BETWEEN A PICKED PHOTO AND A PROVIDER (M3/05, 2026-10-04).
 *
 * Every photograph that leaves this device for an AI goes through
 * `downscaleToJpeg` first, and this is where the result of that step becomes
 * either a file to send or a refusal to send anything. There is no third
 * answer. `downscaleToJpeg` draws the picture onto a canvas and encodes it
 * again, so the JPEG it returns carries no EXIF at all: no GPS position, no
 * camera serial, no capture time. The ORIGINAL file carries all of it.
 *
 * ── WHAT USED TO BE HERE ─────────────────────────────────────────────────
 *
 * `/add/photo` caught a failed downscale (a HEIC outside Safari, a decoder
 * that gave up) and sent the original instead, "when the browser will still
 * accept it". The original is the one file that holds the person's location,
 * so the fallback sent the most identifying version of the picture exactly
 * when the careful path had failed. `/pantry` never downscaled at all.
 *
 * A file that cannot be prepared is not sent. The caller says so and asks for
 * another photo.
 *
 * The downscaler is a parameter so a test can make it fail; the default is the
 * real one, which only runs in a browser.
 */
import { downscaleToJpeg } from '#app/lib/photo-constraints';

/** The two answers: the re-encoded file, or nothing to send. There is no way to get the original back out. */
export type UploadPhotoPreparation = { kind: 'ready'; file: File } | { kind: 'not-prepared' };

/**
 * Re-encodes a picked photo for upload.
 *
 * @param input.picked - the file the person picked or the camera took.
 * @param input.downscale - the transcoder. Defaults to `downscaleToJpeg`.
 * @returns the JPEG to send, or `not-prepared` when the browser could not make one.
 */
export async function prepareUploadPhoto({
  picked,
  downscale = downscaleToJpeg,
}: {
  picked: File;
  downscale?: (file: File) => Promise<File>;
}): Promise<UploadPhotoPreparation> {
  try {
    return { kind: 'ready', file: await downscale(picked) };
  } catch {
    return { kind: 'not-prepared' };
  }
}
