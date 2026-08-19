/**
 * Form-encoding for `LocalFoodLog.netCarbsPer100g` — the authoritative,
 * origin-aware net-carbs figure snapshotted from an upstream source (LCC's
 * `FoodMatch.netCarbsPer100g`) at log time.
 *
 * Several flows carry an already-decided figure through a form on its way back
 * into the local store (the add flow's portion step, the diary's undo-delete
 * restore). Form values are strings, and this field has THREE meaningful
 * states, not two — so a bare `String(value)` round-trip would collapse them:
 *
 *  - `undefined` — no authoritative figure was captured. The reader falls back
 *    to `carbs - fiber - polyols` from the entry's own macros, which is the
 *    right answer for manual entries and AI plate estimates.
 *  - `null`      — an upstream source WAS consulted and its figure is genuinely
 *    unknown for this food. Must never be fabricated into a 0.
 *  - a number    — the authoritative figure, which wins over the parts.
 *
 * `''` and `'null'`/`'undefined'` are all things a naive encoding produces for
 * the two non-numeric states, which is why the unknown marker below is an
 * explicit, non-colliding word instead.
 *
 * Pure string/number helpers plus one zod field — no store, no browser, no
 * React — so this unit-tests directly.
 */
import { z } from 'zod';

/**
 * A submitted form value before validation: the hidden input's text, or — when
 * something upstream is wrong — any other already-parsed JSON value.
 */
export type SubmittedFieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SubmittedFieldValue[]
  | { [key: string]: SubmittedFieldValue };

/** The hidden input as it arrives from a form submission; anything else reads as absent. */
const submittedFieldValue = z.string().nullish().catch(undefined);

/**
 * Wire marker for "an upstream source was consulted and had no figure"
 * (`null`), kept distinct from the empty string that means "no figure was ever
 * captured" (`undefined`). Deliberately not `'null'`: that is what
 * `String(null)` produces, so a future accidental `String(value)` encoding
 * would silently look correct for the null case while mangling the others.
 */
export const AUTHORITATIVE_NET_CARBS_UNKNOWN = 'unknown';

/**
 * Encodes a three-state authoritative net-carbs figure into one form value.
 *
 * @param value - the figure, `null` (upstream unknown), or `undefined` (never captured).
 * @returns the string to put in a hidden input / submit payload.
 */
export function encodeAuthoritativeNetCarbs(value: number | null | undefined): string {
  if (value === undefined) return '';
  if (value === null) return AUTHORITATIVE_NET_CARBS_UNKNOWN;
  return String(value);
}

/**
 * Decodes one form value back into the three-state figure.
 *
 * FAILS OPEN, never throws: every writer of this field is our own hidden input
 * (never a user-typed control), so a malformed value means a bug upstream, not
 * bad user input — and refusing the whole log over it would block a person
 * from tracking their food. An unparseable value degrades to `undefined`,
 * i.e. "no authoritative figure", which is exactly the pre-existing
 * compute-from-parts behaviour rather than a wrong number.
 *
 * @param raw - the submitted form value (absent when the field wasn't sent).
 * @returns the figure, `null` (upstream unknown), or `undefined` (not captured).
 */
export function decodeAuthoritativeNetCarbs(raw: SubmittedFieldValue): number | null | undefined {
  const text = submittedFieldValue.parse(raw);
  if (text === null || text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (trimmed === AUTHORITATIVE_NET_CARBS_UNKNOWN) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * The zod field every action parsing this value should use, so the three-state
 * decoding lives in exactly one place. Optional AND nullable on purpose — the
 * two non-numeric states are distinct and both must survive parsing.
 */
export const authoritativeNetCarbsField = z.preprocess(
  (raw) => decodeAuthoritativeNetCarbs(submittedFieldValue.parse(raw)),
  z.number().nonnegative().nullable().optional(),
);
