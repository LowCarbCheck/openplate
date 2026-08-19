/**
 * The one "log today's weight" schema, shared by the two routes that offer the
 * form: `/settings/goals` (the full weight card) and `/trends` (the one-field
 * quick log beside the chart).
 *
 * Extracted rather than copied when the quick log landed on Progress: two
 * definitions of the same field is how the same typo gets accepted on one
 * screen and rejected on the other, and how the sanity bounds drift apart.
 *
 * The schema is built per call, not held as a module constant, because its
 * messages are user-facing copy — they have to resolve against the ACTIVE
 * language, which isn't known at module-eval time.
 */
import { z } from 'zod';

/** Sanity bounds for a logged weight (kg). */
export const WEIGHT_MIN_KG = 20;
export const WEIGHT_MAX_KG = 500;

/** Translation lookup, threaded in so this module stays free of the i18next singleton. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * The weigh-in schema. The visible input is unit-aware; by the time a value
 * reaches here it is already kilograms (see `toWeightSubmitValue`), so a
 * filled-but-unreadable field arrives as raw text and fails with "Enter a
 * valid number" rather than submitting blank.
 *
 * @param t - the caller's translator.
 * @returns a Zod object schema with a single `weightKg` field.
 */
export function makeLogWeightSchema(t: Translate) {
  return z.object({
    weightKg: z
      .string({ error: t('goals.weight.errors.required') })
      .trim()
      .min(1, t('goals.weight.errors.required'))
      .transform((value) => Number(value))
      .refine((value) => Number.isFinite(value), t('goals.weight.errors.notANumber'))
      .refine(
        (value) => value >= WEIGHT_MIN_KG && value <= WEIGHT_MAX_KG,
        t('goals.weight.errors.outOfRange', { min: WEIGHT_MIN_KG, max: WEIGHT_MAX_KG }),
      ),
  });
}
