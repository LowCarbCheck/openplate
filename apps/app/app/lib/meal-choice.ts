/**
 * The one description of "which meal did this food go into", shared by every
 * surface that lets a person choose one.
 *
 * It was `/add`'s alone until M202. The scan confirm step had no meal control
 * at all and wrote a hardcoded `mealType: null` for every photographed food, so
 * a photographed lunch fell out of the diary's lunch group with no way to put
 * it back. Giving the scan its own copy of this list would have been the easy
 * fix and the wrong one: the four slots, the "no meal" sentinel, the label keys
 * and the form field all have to agree across surfaces, and four copies agree
 * only until someone edits one.
 *
 * The WINDOWS that map a time of day onto one of these slots are NOT here.
 * `#app/lib/meal-time` owns them, and there is exactly one such rule.
 */
import { z } from 'zod';
import type { MealType } from '#types/enums';

/** The four slots, in the order every dropdown lists them. */
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const satisfies readonly MealType[];

/**
 * Radix `<Select>` forbids an empty-string item value, so "no meal chosen"
 * rides on this sentinel in the UI and is normalized to `''` in the hidden
 * input (which the schema then maps to `undefined`).
 */
export const NO_MEAL_VALUE = 'none';

/**
 * Translation keys for the meal-type enum, plus the "no meal chosen" state.
 * Used for the dropdown options, the trigger's displayed value AND the
 * add-toast's meal clause. Radix's `<SelectValue>` mirrors the selected
 * `<SelectItem>`'s own text content, not a CSS `capitalize` class applied to
 * it, so relying on `className="capitalize"` around the raw lowercase enum
 * value (the old approach) capitalized the dropdown row but left the trigger
 * showing the raw "snack" (defect). A real label fixes both at once.
 *
 * `none` is here rather than translated at the toast call site so the select's
 * "No meal" row and the toast's meal clause can never drift apart, the same
 * reason `#app/lib/meal-time`'s `mealLabel` (which this replaces at every
 * call site in `/add`) held both.
 *
 * The keys are still under `add.*` in the catalog: the strings are unchanged
 * and shared, and renaming a live key to look tidier would churn both language
 * bundles for nothing.
 */
export const MEAL_LABEL_KEYS = {
  none: 'add.meal.none',
  breakfast: 'add.meal.breakfast',
  lunch: 'add.meal.lunch',
  dinner: 'add.meal.dinner',
  snack: 'add.meal.snack',
} satisfies Record<MealType | 'none', string>;

/**
 * The posted meal field, as every form submits it: the sentinel is already
 * normalized to `''` by the hidden input, and `''` decodes to `undefined`,
 * which each caller stores as `null` ("this entry has no meal").
 */
export const mealTypeFormField = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.enum(MEAL_TYPES).optional(),
);
