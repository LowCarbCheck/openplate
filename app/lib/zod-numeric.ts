import { z } from 'zod';

/**
 * Optional numeric form field. Blank/whitespace-only input becomes
 * `undefined` (unknown) rather than silently coercing to `0` — the naive
 * `z.coerce.number().optional()` treats `''` as `0` (`Number('') === 0`),
 * which would fabricate precision the user never entered.
 */
export function createOptionalNonNegativeNumberSchema(): z.ZodType<number | undefined> {
  return z.preprocess(
    (value) => {
      const asText = z.string().safeParse(value);
      return asText.success && asText.data.trim() === '' ? undefined : value;
    },
    z.coerce.number().nonnegative().optional(),
  );
}

/**
 * Required numeric form field that rejects blank input with `message`
 * instead of silently coercing it to `0`.
 */
export function createRequiredNonNegativeNumberSchema(message: string): z.ZodType<number> {
  return z
    .string({ error: message })
    .trim()
    .min(1, message)
    .transform((value) => Number(value))
    .refine((value) => !Number.isNaN(value) && value >= 0, 'Enter a valid non-negative number');
}
