/**
 * The ONLY two doors through which a thrown value reaches a log line, a stderr
 * write or a response.
 *
 * WHY A DOOR AT ALL. `logger.ts` types a field as "any string", so the type
 * system cannot tell `{ error: cause.message }` from `{ status: 'ok' }`. And
 * `cause.message` is not ours: a body parser quotes the stretch of JSON it
 * choked on, a driver quotes the row it refused, a provider's SDK quotes the
 * request it rejected. On this service the request can be a plate photograph
 * it promised not to keep. Reading the message is the leak; scrubbing it
 * afterwards is a second line of defence, not the first.
 *
 * So the rule is structural. Nothing outside this file reads `.message` of a
 * caught value to log it, and `tests/unit/log-allow-list.test.ts` scans every
 * file under `src/` and fails when something does.
 *
 *  - {@link errorFields} is the default. It yields a name and a code, both
 *    checked against a short character class, so neither can carry free text.
 *  - {@link scrubbedErrorMessage} is for the one case where an operator needs
 *    the words: a failure BEFORE the listener opens (a bad `DATABASE_URL`, a
 *    missing secret) or in an operator CLI, where no request exists to have
 *    leaked. It still scrubs and still caps.
 */
import { asNumber, asString, type JsonValue } from './lib/json.js';
import { scrubPayloads } from './ai/scrub.js';

/** What a log line may say about a failure: which kind, and which code. Never the words. */
export interface ErrorFields {
  errorName: string;
  errorCode: string | null;
}

/** The hard cap on a message that does reach an operator, in characters. */
export const SCRUBBED_ERROR_MESSAGE_MAX_CHARS = 200;

/** How many `cause` links are followed to find a code. `fetch failed` hides its `ECONNREFUSED` one level down. */
const MAX_CAUSE_DEPTH = 4;

/**
 * What a name or a code may look like: `TypeError`, `ECONNREFUSED`, `23505`,
 * `UND_ERR_HEADERS_TIMEOUT`, `ERR_INVALID_URL`. No space, no quote, no way to
 * smuggle a sentence through a property somebody set to one.
 */
const SAFE_TOKEN = /^[A-Za-z0-9_.$:-]{1,64}$/;

/** The properties this module reads off a caught value. `Object()` boxes, so a primitive simply has none. */
interface ThrownProperties {
  readonly name?: JsonValue;
  readonly code?: JsonValue;
  readonly cause?: JsonValue;
}

function readThrown(cause: unknown): ThrownProperties {
  return Object(cause);
}

function safeToken(candidate: string | null): string | null {
  if (candidate === null) return null;
  return SAFE_TOKEN.test(candidate) ? candidate : null;
}

function codeOf(thrown: ThrownProperties): string | null {
  const text = safeToken(asString(thrown.code));
  if (text !== null) return text;
  const number = asNumber(thrown.code);
  return number === null ? null : safeToken(String(number));
}

/** The first code on the error or on its `cause` chain, or `null`. */
function findCode(cause: unknown): string | null {
  let current: unknown = cause;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const thrown = readThrown(current);
    const code = codeOf(thrown);
    if (code !== null) return code;
    current = thrown.cause;
  }
  return null;
}

/**
 * The name and code of a caught value, safe to spread into any log call:
 * `logger.error('Sweep failed', { ...errorFields(cause) })`.
 *
 * `errorName` is `NonError` for something that was not an `Error`, because JS
 * lets a function `throw 'a string'`, and `Error` for an error whose name is
 * not a plain token.
 */
export function errorFields(cause: unknown): ErrorFields {
  const name = safeToken(asString(readThrown(cause).name));
  const fallback = cause instanceof Error ? 'Error' : 'NonError';
  return { errorName: name ?? fallback, errorCode: findCode(cause) };
}

/**
 * A one-line, scrubbed, 200-character description of a caught value. For a
 * failure at boot or in an operator CLI ONLY, where the words are what the
 * person who runs the service needs and no request has been read yet.
 *
 * Never reachable from a request: a handler that wants to say what failed uses
 * {@link errorFields}. Never a stack and never the `cause` chain, which is
 * where a wrapped library error keeps what it was handed.
 */
export function scrubbedErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : 'unknown error';
  return scrubPayloads(raw.replaceAll(/\s+/g, ' '), { maxChars: SCRUBBED_ERROR_MESSAGE_MAX_CHARS });
}
