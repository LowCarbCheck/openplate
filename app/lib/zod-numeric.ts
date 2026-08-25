import { z } from 'zod';
import i18next from '#app/i18n/i18n';

/**
 * The narrow slice of i18next's `t` this module depends on — mirrors the
 * `Translate` type every route/lib schema factory in this repo declares
 * locally (see `app/routes/add.tsx`, `app/lib/weight-log-schema.ts`, etc.).
 */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * Optional numeric form field. Blank/whitespace-only input becomes
 * `undefined` (unknown) rather than silently coercing to `0` — the naive
 * `z.coerce.number().optional()` treats `''` as `0` (`Number('') === 0`),
 * which would fabricate precision the user never entered.
 *
 * `t` defaults to the i18next singleton rather than being required, so every
 * existing call site keeps working unchanged; tests (and any future
 * non-React caller) can still pass a stub translator explicitly, the same
 * shape as `createRequiredNonNegativeNumberSchema`'s `message` — but scoped
 * to just this function's own coercion-failure case, not shared with it.
 *
 * The `error` option below is a THUNK, `() => t(...)`, not a plain string.
 * Zod's `error` param accepts `string | $ZodErrorMap`, and `$ZodErrorMap` is
 * `(issue) => string | { message: string } | undefined | null` (confirmed
 * against the pinned `zod@4.4.3` types in `node_modules/zod/v4/core/api.d.ts`
 * and `errors.d.ts`). A plain string is baked in at SCHEMA CONSTRUCTION time;
 * a function is called at PARSE time. The distinction matters here because
 * `diary.tsx`'s call site builds this schema once at MODULE load — before
 * i18next has a language set — so an eager string would freeze whatever
 * language happened to be active (or none) at import time, forever.
 */
export function createOptionalNonNegativeNumberSchema(
  t: Translate = (key) => i18next.t(key),
): z.ZodType<number | undefined> {
  return z.preprocess(
    (value) => {
      const asText = z.string().safeParse(value);
      return asText.success && asText.data.trim() === '' ? undefined : value;
    },
    z.coerce
      .number({ error: () => t('errors.notANumber') })
      .nonnegative()
      .optional(),
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
