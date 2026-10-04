/**
 * The last line of defence for the privacy promise: a scrubber every string
 * that could have touched a request runs through before it is logged or
 * returned.
 *
 * WHY THIS EXISTS EVEN THOUGH NO CALL SITE LOGS A BODY. Our own call sites are
 * disciplined — `logger.ts`'s field type will not even accept a Buffer. The gap
 * is somebody ELSE's string: a dependency that helpfully includes the input it
 * choked on in its `Error.message`, an upstream provider that echoes the
 * request it rejected, a future contributor who adds one `${error}`. On the
 * happy path none of that fires, which is precisely why the happy path passing
 * proves nothing.
 *
 * A PROXY MAKES THIS SHARPER THAN IT IS IN A NORMAL SERVICE. The body being
 * protected is a plate photograph this service did not produce and does not
 * keep, and the component most likely to quote it back is the upstream
 * provider — the exact string a debugging instinct most wants to log verbatim
 * when a call fails.
 *
 * So: scrub at the boundary, and let a test prove it by throwing an error that
 * DOES carry the base64 and asserting the bytes appear in neither the log lines
 * nor the response body.
 *
 * Ported from `openplate-gateway/src/scrub.ts`. Error values do NOT come
 * through here any more: `log-error.ts` is the door for those, and it logs a
 * name and a code. This module scrubs the strings that are text by nature, the
 * upstream's error body above all.
 */
const REDACTED = '[redacted]';

/**
 * One character of a base64 payload, in every dress a payload arrives in:
 *
 *  - the standard alphabet and the URL-safe one (`-` and `_`), and `=` padding;
 *  - `\/` (up to four backslashes, for a body that was encoded again), because
 *    PHP's `json_encode` and some echoing proxies escape the slash, which would
 *    otherwise end a run in the middle of a photograph and leave the pieces
 *    under the length floor;
 *  - `\u002b`, `\u002f` and `\u003d`, the same escape written as a code point;
 *  - `%2B`, `%2F` and `%3D`, a payload that went through a form encoder.
 *
 * Alternatives start with different characters, so none of them backtracks
 * into another.
 */
const BASE64_CHAR = String.raw`(?:[A-Za-z0-9+/=_-]|\\{1,4}/|\\u002[bBfF]|\\u003[dD]|%2[bBfF]|%3[dD])`;

/**
 * A data URI of any media type. The payload class deliberately excludes
 * whitespace: a real data URI contains none, and including `\s` here made the
 * match run past the URI and eat the rest of the sentence, which destroys the
 * message a human is meant to read.
 */
const DATA_URI = new RegExp(String.raw`data:[a-zA-Z0-9.+/-]+;base64,${BASE64_CHAR}+`, 'g');

/**
 * A bare base64-ish run. 48 characters is well below any real image payload and
 * well above any identifier this service logs (a family id is 32 hex, a UUID is
 * 36), so this cannot eat a field somebody wanted to read.
 *
 * THE URL-SAFE ALPHABET COSTS A LITTLE READABILITY: a 48-character kebab-case
 * or snake_case word is now a run. That is the safe direction, see the test
 * for the data-URI-free case.
 */
const LONG_BASE64_RUN = new RegExp(String.raw`${BASE64_CHAR}{48,}`, 'g');

/** What a capped string ends with, so a reader knows it was cut. Plain ASCII, no run of base64. */
const TRUNCATION_SUFFIX = '...[truncated]';

/**
 * The cap on scrubbed output when a caller names none. Above the 4096 an
 * upstream error body is sliced to before it gets here, so it never bites
 * there, and well below anything that could be a photograph.
 */
export const DEFAULT_SCRUBBED_MAX_CHARS = 4096;

export interface ScrubOptions {
  /** The most characters of the scrubbed text kept, before the truncation marker. */
  maxChars?: number;
}

/**
 * Replaces data URIs and long base64 runs with a marker, then caps the length.
 * Idempotent.
 *
 * REDACT FIRST, CUT SECOND. Cutting first could split a run and leave a tail
 * under the 48-character floor; cutting a redacted string cannot.
 */
export function scrubPayloads(text: string, options: ScrubOptions = {}): string {
  const maxChars = options.maxChars ?? DEFAULT_SCRUBBED_MAX_CHARS;
  const redacted = text.replace(DATA_URI, REDACTED).replace(LONG_BASE64_RUN, REDACTED);
  if (redacted.length <= maxChars) return redacted;
  return `${redacted.slice(0, maxChars)}${TRUNCATION_SUFFIX}`;
}

/** TEMPORARY, removed with the last call site in the commit that adds `log-error.ts`. */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? scrubPayloads(cause.message) : 'unknown error';
}
