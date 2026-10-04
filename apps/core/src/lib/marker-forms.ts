/**
 * The forms a marker takes in a log, shared by the photo path guard and the
 * production canary (`scripts/sync-api/canary.ts`).
 *
 * WHY A MARKER IS SEARCHED AS WINDOWS. A leak is rarely the whole photograph. A
 * `Buffer` printed by `util.inspect`, a base64 string cut to 200 characters or an
 * error that quotes a slice of a body keeps a stretch of bytes, so any 12-byte
 * window of the marker that survives in any form is a hit, whichever slice the
 * leak kept. The guard searches its own process output with these. The canary
 * prints them, and an operator greps the real host's logs for them.
 *
 * WHY THE THREE ALIGNMENTS. Base64 encodes three bytes to four characters, so
 * the same 12 bytes encode differently depending on where they start modulo
 * three. A search for one alignment misses two thirds of the places the marker
 * can sit. The characters at the edges of a window also depend on the bytes next
 * to it, so they are left out of the needle.
 *
 * Pure module: bytes in, text out. No config, no clock, no file.
 */

/** The bytes of a marker a window is cut from. 12 is long enough that a chance hit in random bytes is out of the question. */
export const WINDOW_BYTES = 12;

/** How many base64 alignments exist: where a window starts modulo three. */
export const BASE64_ALIGNMENTS = [0, 1, 2] as const;

/** The base64 text of a window that does not depend on its neighbours, for one alignment of its start. */
export function base64WindowText(input: { window: Buffer; alignment: number }): string {
  const { window, alignment } = input;
  const encoded = Buffer.concat([Buffer.alloc(alignment), window]).toString('base64');
  const start = Math.ceil((4 * alignment) / 3);
  const end = Math.floor((8 * (alignment + window.length)) / 6);
  return encoded.slice(start, end);
}

/** Standard base64 as the URL-safe alphabet writes it: `-` for `+` and `_` for `/`. */
export function toUrlSafe(base64: string): string {
  return base64.replaceAll('+', '-').replaceAll('/', '_');
}

/** One window of a marker, in the forms a log search needs. */
export interface MarkerWindowForms {
  /** Where the window starts in the marker, in bytes. */
  start: number;
  hex: string;
  /** Base64 text of the window, for a start at 0, 1 and 2 modulo three. */
  base64: string[];
  /** The same three, in the URL-safe alphabet. */
  urlSafeBase64: string[];
}

/** Every {@link WINDOW_BYTES}-byte window of a marker, each in hex and in base64 at all three alignments. */
export function markerWindowForms(marker: Buffer): MarkerWindowForms[] {
  const forms: MarkerWindowForms[] = [];
  for (let start = 0; start + WINDOW_BYTES <= marker.length; start += 1) {
    const window = marker.subarray(start, start + WINDOW_BYTES);
    const base64 = BASE64_ALIGNMENTS.map((alignment) => base64WindowText({ window, alignment }));
    forms.push({ start, hex: window.toString('hex'), base64, urlSafeBase64: base64.map(toUrlSafe) });
  }
  return forms;
}
