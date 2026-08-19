/**
 * Narrows a Conform field's current value into a number for live macro/portion
 * previews. Conform types field `.value` as `unknown` (a string from user
 * input, a number from `defaultValue`, or absent), so this runtime-narrows
 * rather than trusting an unsafe cast. Pure — unit-tested without React.
 */
import { z } from 'zod';

/**
 * A Conform field's current `.value`: text typed into the input, a number
 * carried over from `defaultValue`, a repeated field's list, a nested
 * fieldset's object, or nothing at all.
 */
export type ConformFieldValue =
  | string
  | number
  | null
  | undefined
  | readonly ConformFieldValue[]
  | { readonly [key: string]: ConformFieldValue };

/** The numeric field value, parsed out of whatever the field currently holds. */
const numericFieldValue = z.union([z.number(), z.string().trim().min(1).pipe(z.coerce.number())]);

/**
 * Parses a Conform field value into a number, returning `null` for
 * blank/missing/non-numeric input (so an unknown macro stays unknown rather
 * than reading as 0).
 *
 * @param value - the field's `.value`.
 * @returns the parsed number, or `null` when there is no usable numeric value.
 */
export function parseNumericFieldValue(value: ConformFieldValue): number | null {
  const parsed = numericFieldValue.safeParse(value);
  if (!parsed.success) return null;
  return Number.isFinite(parsed.data) ? parsed.data : null;
}
