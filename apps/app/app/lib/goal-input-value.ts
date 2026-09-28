/**
 * goal-input-value.ts: a stored number as the text a number field can hold.
 *
 * Shared by `/settings/nutrition` (the four target fields) and
 * `/settings/profile` (the weigh-in field), which were one page until M215
 * spec 03 split them.
 *
 * Deliberately the PINNED formatter, never the locale-aware one: this is a
 * form field's value, which the browser rejects and `Number()` reads as `NaN`
 * if it carries a German comma. A blank string for a missing value, because a
 * blank field is how a person clears a goal, and a `0` would be a target.
 */
import { formatMacroNumber } from '#app/lib/format-macro-number';

/**
 * @param value - the stored number, or `null` when nothing is set.
 * @returns the field's text: blank for `null`, otherwise the compact number.
 */
export function toGoalInputValue(value: number | null): string {
  return value === null ? '' : formatMacroNumber(value);
}
