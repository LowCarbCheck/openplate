/**
 * Form-encoding for `LocalFoodLog.portion` — the DISPLAY portion a person
 * actually chose ("2 eggs"), carried through a form on its way (back) into the
 * local store. The exact sibling of `#app/lib/authoritative-net-carbs`, one
 * field over, and it exists for the same reason: several flows now hand this
 * value through a form (the add flow's portion step, the diary's frequent /
 * favourite chip re-log, the undo-delete restore), and a second hand-rolled
 * copy of a JSON-shaped encoding is precisely how one of them ends up dropping
 * the field silently. It lives here rather than in a route so every writer
 * shares one encoder and one validator.
 *
 * Two states only, unlike its net-carbs sibling: either a portion was chosen or
 * it wasn't. "No portion" is the empty string, decoded back to `undefined`
 * (which every writer then persists as `null`) — there is no third "upstream
 * was consulted and had none" state to keep distinct, because a portion is the
 * person's own choice, not a fact fetched from a source.
 *
 * FAILS OPEN, never throws: every writer of this field is our own hidden input,
 * built by `JSON.stringify` on a value the app itself derived from
 * `derivePortionChoices` — never third-party or user-typed input. So a
 * malformed value means a bug upstream, and refusing the whole submission over
 * it would block a person from logging their food to protect a display nicety.
 * A bad value degrades to "no portion chosen", i.e. the entry renders plain
 * grams — `quantityGrams` is always the authoritative amount regardless.
 *
 * Pure zod + string handling — no store, no browser, no React — so it
 * unit-tests directly.
 */
import { z } from 'zod';
import { HOUSEHOLD_UNITS } from './household-units';
import type { DisplayPortion, PortionUnitId } from './types';

/**
 * The closed set of portion unit ids, derived from `HOUSEHOLD_UNITS` itself
 * plus the generic `'serving'` fallback — rather than a hand-duplicated
 * literal list, so this validator can't silently drift if a unit is ever added
 * to that table.
 */
// SAFETY: the literal `'serving'` leads the array, so it always has at least
// one element — the non-empty tuple `z.enum` requires.
const PORTION_UNIT_IDS = ['serving', ...HOUSEHOLD_UNITS.map((unit) => unit.id)] as [PortionUnitId, ...PortionUnitId[]];

/** The submitted field as it arrives from a form; anything else reads as absent. */
const submittedFieldValue = z.string().nullish().catch(undefined);

/** The shape of a `DisplayPortion` as it arrives from a form (already JSON-parsed). */
export const displayPortionSchema = z.object({
  unit: z.enum(PORTION_UNIT_IDS),
  quantity: z.number().positive(),
  gramsPerUnit: z.number().positive(),
});

/**
 * The zod field every action parsing a submitted display portion should use,
 * so the decoding lives in exactly one place. Optional: an absent, blank, or
 * malformed value all mean "grams only".
 *
 * The shape check happens INSIDE the preprocess step, not only in the outer
 * schema, so that a well-formed-JSON-but-wrong-shape value degrades like every
 * other malformed one instead of raising a field error. Leaving it to the outer
 * schema alone is a real failure mode, not a hypothetical: the diary's chip
 * re-log rejects a failed parse with a 400, so one bad portion value would stop
 * a person from logging their food entirely — over a display label. The outer
 * `displayPortionSchema.optional()` stays as the type source and a second gate.
 */
export const portionField = z.preprocess((value) => {
  const text = submittedFieldValue.parse(value);
  if (text === null || text === undefined || text.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const result = displayPortionSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}, displayPortionSchema.optional());

/**
 * Encodes a chosen display portion into one hidden-input value. The inverse of
 * `portionField`; named (rather than inlined as a ternary at each writer)
 * for the same reason `encodeAuthoritativeNetCarbs` is — so the "no portion"
 * wire value is decided once and can't be spelled three different ways.
 *
 * @param portion - the chosen portion, or `null`/`undefined` for a grams-only entry.
 * @returns the string to put in a hidden input / submit payload.
 */
export function encodeDisplayPortion(portion: DisplayPortion | null | undefined): string {
  return portion ? JSON.stringify(portion) : '';
}
