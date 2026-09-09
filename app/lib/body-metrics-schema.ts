/**
 * The Conform/Zod schema for the body-metrics form on `/settings/goals`.
 *
 * It is a thin wrapper over the pure parsers in `#app/models/body-metrics` —
 * every bound (plausible height, age floor and ceiling) still lives there, in
 * exactly one place, so this file can never disagree with the onboarding step
 * about what a typed height means. All it adds is the two things Conform needs
 * and the parsers deliberately don't have: user-facing messages, and the
 * blank-vs-unreadable distinction expressed as a Zod issue.
 *
 * Built per call rather than held as a module constant, like
 * `#app/lib/weight-log-schema`: the messages are copy, so they have to resolve
 * against the ACTIVE language, which isn't known at module-eval time.
 *
 * ── Why every field is optional ────────────────────────────────────────────
 *
 * Blank always means "not told us" and clears that metric. Only a field the
 * person FILLED IN that can't be read is an error — a blank one is an answer.
 */
import { z } from 'zod';
import {
  inspectLactationStartDate,
  inspectPregnancyDueDate,
  MAX_WEEKS_UNTIL_DUE_DATE,
  parseBiologicalSex,
  parseBirthYear,
  parseHeightCm,
  parseReproductiveStatus,
  reproductiveDateErrorKey,
} from '#app/models/body-metrics';
import type { ReproductiveDateOutcome } from '#app/models/body-metrics';

/** Translation lookup, threaded in so this module stays free of the i18next singleton. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** An absent field and an empty one are the same thing here: "not given". */
function optionalText() {
  return z
    .string()
    .optional()
    .transform((raw) => raw ?? '');
}

/**
 * Wraps one of the pure numeric parsers so a blank field passes as `null` while
 * a filled-in-but-unreadable one fails with `message`.
 *
 * @param parse - the pure parser from `#app/models/body-metrics`.
 * @param message - the already-translated error copy.
 * @returns a schema resolving to the parsed number, or `null` when blank.
 */
function optionalNumericField(parse: (raw: string) => number | null, message: string) {
  return optionalText()
    .transform((raw) => ({ raw, value: parse(raw) }))
    .refine(({ raw, value }) => raw.trim() === '' || value !== null, message)
    .transform(({ value }) => value);
}

/**
 * Wraps one of the two reproductive-date inspectors so a blank field passes as
 * `null` while a filled-in one that can't be stored fails with the sentence its
 * OWN reason earns. "That date has already passed" and "that date is years
 * away" are different mistakes, and one generic message for both would leave a
 * person retyping the same wrong date.
 *
 * @param inspect - the pure inspector from `#app/models/body-metrics`.
 * @param t - the caller's translator.
 * @returns a schema resolving to the day key, or `null` when blank.
 */
function optionalReproductiveDateField(inspect: (raw: string) => ReproductiveDateOutcome, t: Translate) {
  return optionalText()
    .transform((raw) => inspect(raw))
    .superRefine((outcome, ctx) => {
      if (outcome.kind !== 'rejected') return;
      ctx.addIssue({
        code: 'custom',
        // The ceiling reaches the copy as a parameter, so the number the person
        // reads is the number the parser applied.
        message: t(reproductiveDateErrorKey(outcome.reason), { weeks: MAX_WEEKS_UNTIL_DUE_DATE }),
      });
    })
    .transform((outcome) => (outcome.kind === 'date' ? outcome.value : null));
}

/**
 * The body-metrics schema.
 *
 * @param t - the caller's translator.
 * @param options.currentYear - the year to measure ages against (never read from a clock here).
 * @param options.today - the day to measure the two reproductive dates against.
 * @returns a Zod object schema resolving to the six nullable metrics.
 */
export function makeBodyMetricsSchema(t: Translate, { currentYear, today }: { currentYear: number; today: Date }) {
  return z.object({
    heightCm: optionalNumericField(parseHeightCm, t('bodyMetrics.errors.height')),
    birthYear: optionalNumericField((raw) => parseBirthYear(raw, { currentYear }), t('bodyMetrics.errors.birthYear')),
    // The two radio groups can't be unreadable: an unrecognised value is simply
    // "no answer", which is a legitimate answer here.
    biologicalSex: optionalText().transform((raw) => parseBiologicalSex(raw)),
    reproductiveStatus: optionalText().transform((raw) => parseReproductiveStatus(raw)),
    // Both dates are validated on every submit, whichever status is chosen. The
    // hidden one is blank (the input only renders beside its own chip), and
    // `normalizeBodyMetrics` drops any date whose status went away, so a date
    // typed and then abandoned can never be stored.
    pregnancyDueDate: optionalReproductiveDateField((raw) => inspectPregnancyDueDate(raw, { today }), t),
    lactationStartDate: optionalReproductiveDateField((raw) => inspectLactationStartDate(raw, { today }), t),
  });
}
