/**
 * The pure body-metrics model (M135) — parsing, normalising, age banding and
 * the energy estimate the onboarding step and the goals settings read. No DOM,
 * no store, no `Date.now()`: the current year is always a parameter, exactly as
 * `models/fasting.ts` takes `nowMs`, which is what makes every branch here
 * pinnable by a `node:test` file with no browser and no clock.
 *
 * It may `import type` from `#app/lib/local-store/schema`; that module's own
 * header sanctions this ("Pure types + id constants only … so the pure logic
 * modules and their unit tests stay browser- and store-free").
 *
 * ── Everything is optional, and that is the design ─────────────────────────
 *
 * Every function here answers `null` rather than guessing when an input is
 * missing. There is no default height, no assumed sex, no "typical" age. A
 * person who declines all four gets an app that behaves exactly as it did
 * before this module existed — the only difference is that some suggestions
 * aren't offered. Health data the app can work without is health data the app
 * should not insist on.
 *
 * ── The estimate is a suggestion, never a verdict ──────────────────────────
 *
 * `suggestDailyKcal` exists to fill a field the person then owns, the way
 * `estimateProteinFloorG` does for the protein floor. It is an estimate of energy
 * expenditure, not a prescription, and DESIGN.md §10.1 forbids copy that turns
 * it into one. Pregnancy and lactation deliberately do NOT adjust it: those are
 * clinical adjustments and this is a food log, not a blood panel (M135's locked
 * decision 2).
 */
import type { BiologicalSex, ReproductiveStatus } from '#app/lib/local-store/schema';
import type { Trimester } from '#app/lib/reproductive-stage';
import { MAX_WEEKS_AHEAD, resolveGestation } from '#app/lib/reproductive-stage';
import { parseDateParam } from '#app/lib/user-days';
import type { MissingReferenceDate } from '#app/lib/macro-gaps';

////////////////////////////////////////////////////////////////////////////////
// Shape
////////////////////////////////////////////////////////////////////////////////

/**
 * The optional body metrics, flattened off `LocalProfileGoals` into the shape
 * the forms and the derivations pass around. Every field is nullable and `null`
 * always means "not told us", and an absent key on the stored profile reads back as
 * `null` here (see `readBodyMetrics`).
 *
 * The two dates are OPTIONAL keys as well as nullable values, because a caller
 * that predates them (the onboarding step, which asks for neither) still writes
 * a whole valid record. `readBodyMetrics` always answers with both keys present
 * and `null`, so no reader has to tell "absent" from "not given".
 */
export interface BodyMetrics {
  heightCm: number | null;
  birthYear: number | null;
  biologicalSex: BiologicalSex | null;
  reproductiveStatus: ReproductiveStatus | null;
  /** The expected date of birth as `YYYY-MM-DD` (M206), meaningful only while pregnant. */
  pregnancyDueDate?: string | null;
  /** The child's birth date as `YYYY-MM-DD` (M206), meaningful only while lactating. */
  lactationStartDate?: string | null;
}

/** The "told us nothing" metrics — what every reader sees before onboarding. */
export const EMPTY_BODY_METRICS: BodyMetrics = {
  heightCm: null,
  birthYear: null,
  biologicalSex: null,
  reproductiveStatus: null,
  pregnancyDueDate: null,
  lactationStartDate: null,
};

/** Selectable biological-sex values, in the order the pickers render them. */
export const BIOLOGICAL_SEX_VALUES = ['female', 'male'] as const;

/** Selectable reproductive-status values, `none` first — it is the way out. */
export const REPRODUCTIVE_STATUS_VALUES = ['none', 'pregnant', 'lactating'] as const;

////////////////////////////////////////////////////////////////////////////////
// Bounds
////////////////////////////////////////////////////////////////////////////////

/** Plausible standing-height bounds in cm — wide enough to insult nobody, narrow enough to catch a typo. */
const MIN_HEIGHT_CM = 50;
const MAX_HEIGHT_CM = 260;

/**
 * Age bounds, expressed as years. The lower bound is 14 because the reference
 * data has no band below 14-18 (M135 non-goal) — a younger birth year is not a
 * typo to correct but a person this feature has nothing to say to, so it is
 * rejected rather than silently clamped into the youngest band.
 */
const MIN_AGE_YEARS = 14;
const MAX_AGE_YEARS = 120;

////////////////////////////////////////////////////////////////////////////////
// Parsers — blank is always "not given", never a fabricated value
////////////////////////////////////////////////////////////////////////////////

/** Trimmed string, or `null` for anything blank/absent. */
function trimmedOrNull(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Parses an optional height field (cm). Blank resolves to `null`; a filled-in
 * value that isn't a plausible height also resolves to `null`, which the
 * caller distinguishes from blank via `validateBodyMetricsForm` below.
 *
 * @param raw - the raw form value.
 * @returns a whole-centimetre height, or `null`.
 */
export function parseHeightCm(raw: string | null | undefined): number | null {
  const trimmed = trimmedOrNull(raw);
  if (trimmed === null) return null;
  // Accept the decimal comma a German keyboard produces, same as the weight
  // fields do (`#app/lib/weight-units`), then round: a centimetre of height
  // precision is already far past what an age-banded RDA table can use.
  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < MIN_HEIGHT_CM || rounded > MAX_HEIGHT_CM) return null;
  return rounded;
}

/**
 * Parses an optional birth-year field. Blank resolves to `null`; a year that
 * would put the person outside `MIN_AGE_YEARS`…`MAX_AGE_YEARS` resolves to
 * `null` too (see the bounds comment for why the young end is a refusal rather
 * than a clamp).
 *
 * @param raw - the raw form value.
 * @param currentYear - the year to measure age against (never read from a clock here).
 * @returns a four-digit birth year, or `null`.
 */
export function parseBirthYear(
  raw: string | null | undefined,
  { currentYear }: { currentYear: number },
): number | null {
  const trimmed = trimmedOrNull(raw);
  if (trimmed === null) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value)) return null;
  const age = currentYear - value;
  if (age < MIN_AGE_YEARS || age > MAX_AGE_YEARS) return null;
  return value;
}

/**
 * Narrows a raw form value to a biological sex, or `null` for "prefer not to
 * say" (which is a real, storable answer here — it stores nothing).
 *
 * @param raw - the raw form value.
 * @returns a valid `BiologicalSex`, or `null`.
 */
export function parseBiologicalSex(raw: string | null | undefined): BiologicalSex | null {
  return BIOLOGICAL_SEX_VALUES.find((value) => value === raw) ?? null;
}

/**
 * Narrows a raw form value to a reproductive status. Anything unrecognised —
 * including a blank field — resolves to `null`, never to a guess.
 *
 * @param raw - the raw form value.
 * @returns a valid `ReproductiveStatus`, or `null`.
 */
export function parseReproductiveStatus(raw: string | null | undefined): ReproductiveStatus | null {
  return REPRODUCTIVE_STATUS_VALUES.find((value) => value === raw) ?? null;
}

////////////////////////////////////////////////////////////////////////////////
// The two reproductive dates
////////////////////////////////////////////////////////////////////////////////

/**
 * The ceiling on a typed due date, in weeks from today: 42, two weeks past full
 * term. Named here as well as in `#app/lib/reproductive-stage` because this is
 * the module the form talks to, and because the number is interpolated into the
 * error copy, so the bound the person reads and the bound the parser applies are
 * the same value.
 *
 * It is an ALIAS, never a second literal: `resolveGestation` owns the arithmetic
 * and refusing a date beyond it is simply "no stage falls out of this date".
 */
export const MAX_WEEKS_UNTIL_DUE_DATE = MAX_WEEKS_AHEAD;

/** Why a filled-in reproductive date could not be stored. */
export type ReproductiveDateRejection = 'unreadable' | 'past' | 'too-far' | 'future';

/**
 * What one of the two date fields means. Three outcomes, not two, because the
 * form has to tell "declined" from "typed something we can't use", the same
 * blank-is-an-answer rule the numeric fields follow, plus a reason, because
 * "that date has already gone" and "that date is years away" are different
 * mistakes and deserve different sentences.
 */
export type ReproductiveDateOutcome =
  | { kind: 'blank' }
  | { kind: 'date'; value: string }
  | { kind: 'rejected'; reason: ReproductiveDateRejection };

/** i18n KEYS (not copy) for a reproductive date that was filled in but can't be stored. */
export const BODY_DUE_DATE_RANGE_KEY = 'bodyMetrics.reproductive.errors.dueDateRange';
export const BODY_DUE_DATE_PAST_KEY = 'bodyMetrics.reproductive.errors.dueDatePast';
export const BODY_START_DATE_FUTURE_KEY = 'bodyMetrics.reproductive.errors.startDateFuture';

/**
 * The i18n key for a rejection reason.
 *
 * @param reason - why the date was refused.
 * @returns the key to translate, never the copy itself.
 */
export function reproductiveDateErrorKey(reason: ReproductiveDateRejection): string {
  if (reason === 'past') return BODY_DUE_DATE_PAST_KEY;
  if (reason === 'future') return BODY_START_DATE_FUTURE_KEY;
  return BODY_DUE_DATE_RANGE_KEY;
}

/**
 * The calendar day a `Date` falls on, in UTC.
 *
 * UTC because `#app/lib/reproductive-stage` compares day keys as UTC days, and
 * a parser that disagreed with the resolver about which day "today" is would
 * refuse a due date the dashboard then happily reports a week for. Callers that
 * care about a person's own midnight pass a `Date` built from `todayInTimezone`.
 */
function utcDayKey(today: Date): string {
  return today.toISOString().slice(0, 10);
}

/**
 * Reads a typed pregnancy due date, with the reason when it cannot be used.
 *
 * @param raw - the raw form value (a `type="date"` input submits `YYYY-MM-DD`).
 * @param options.today - the day to measure against; never read from a clock here.
 * @returns blank, the day key, or the rejection reason.
 */
export function inspectPregnancyDueDate(
  raw: string | null | undefined,
  { today }: { today: Date },
): ReproductiveDateOutcome {
  const trimmed = trimmedOrNull(raw);
  if (trimmed === null) return { kind: 'blank' };
  const date = parseDateParam(trimmed);
  if (date === null) return { kind: 'rejected', reason: 'unreadable' };
  const todayKey = utcDayKey(today);
  if (date < todayKey) return { kind: 'rejected', reason: 'past' };
  // The ceiling is asked of the resolver rather than recomputed: a date that
  // yields no gestation stage, having already passed the past check above, is
  // by definition more than `MAX_WEEKS_UNTIL_DUE_DATE` weeks out.
  if (resolveGestation({ dueDate: date, today: todayKey }) === null) return { kind: 'rejected', reason: 'too-far' };
  return { kind: 'date', value: date };
}

/**
 * Reads a typed lactation start date (the birth date), with the reason when it
 * cannot be used. Only the future is refused: breastfeeding a three-year-old is
 * an ordinary answer, and the app asks about a stale record rather than
 * refusing to store one (M206/04).
 *
 * @param raw - the raw form value.
 * @param options.today - the day to measure against.
 * @returns blank, the day key, or the rejection reason.
 */
export function inspectLactationStartDate(
  raw: string | null | undefined,
  { today }: { today: Date },
): ReproductiveDateOutcome {
  const trimmed = trimmedOrNull(raw);
  if (trimmed === null) return { kind: 'blank' };
  const date = parseDateParam(trimmed);
  if (date === null) return { kind: 'rejected', reason: 'unreadable' };
  if (date > utcDayKey(today)) return { kind: 'rejected', reason: 'future' };
  return { kind: 'date', value: date };
}

/**
 * The pregnancy due date to store: the day key, or `null` for blank AND for
 * anything unusable, the same shape as `parseHeightCm`, and for the same
 * reason. Callers that must tell those two apart ask `inspectPregnancyDueDate`.
 *
 * @param raw - the raw form value.
 * @param options.today - the day to measure against.
 * @returns a `YYYY-MM-DD` day key, or `null`.
 */
export function parsePregnancyDueDate(raw: string | null | undefined, { today }: { today: Date }): string | null {
  const outcome = inspectPregnancyDueDate(raw, { today });
  return outcome.kind === 'date' ? outcome.value : null;
}

/**
 * The lactation start date to store, on the same rule as
 * {@link parsePregnancyDueDate}.
 *
 * @param raw - the raw form value.
 * @param options.today - the day to measure against.
 * @returns a `YYYY-MM-DD` day key, or `null`.
 */
export function parseLactationStartDate(raw: string | null | undefined, { today }: { today: Date }): string | null {
  const outcome = inspectLactationStartDate(raw, { today });
  return outcome.kind === 'date' ? outcome.value : null;
}

////////////////////////////////////////////////////////////////////////////////
// Normalisation
////////////////////////////////////////////////////////////////////////////////

/**
 * The one place the status ↔ sex ↔ date invariants are enforced.
 *
 * A stored pregnancy or lactation status is dropped beside an explicit
 * `biologicalSex === 'male'` and only there. "Prefer not to say" and no answer
 * at all both KEEP it (widened in M206): a person can be pregnant without having
 * told this app their sex, and the earlier rule made them choose between the two
 * answers. Switching to `male` still drops the status rather than leaving it
 * stranded in the store where no screen would ever show it again, a hidden
 * answer the person cannot see is one they cannot withdraw.
 *
 * `none` is normalised to `null` for the same reason: they mean the same thing
 * and storing both invites two readers to disagree about which is "unset".
 *
 * The two dates follow their own status by exactly the same argument, which is
 * why a status that just went away takes its date with it.
 *
 * @param metrics - the metrics as entered.
 * @returns the metrics with the invariants applied, both dates always present.
 */
export function normalizeBodyMetrics(metrics: BodyMetrics): BodyMetrics {
  const status = resolveStoredStatus(metrics);
  return {
    ...metrics,
    reproductiveStatus: status,
    // A date only survives beside the status it belongs to. Dropping it here is
    // what stops a due date outliving the pregnancy, or a birth date reappearing
    // if somebody switches back to `lactating` months later, and it is why
    // `readBodyMetrics` runs this on the way OUT of the store as well as in:
    // a restored backup is lossless by design, and this is the reader that
    // refuses what the envelope faithfully kept.
    pregnancyDueDate: status === 'pregnant' ? (metrics.pregnancyDueDate ?? null) : null,
    lactationStartDate: status === 'lactating' ? (metrics.lactationStartDate ?? null) : null,
  };
}

/**
 * The reproductive status as it may be STORED, which is not always the one that
 * was submitted.
 *
 * Only an explicit `male` makes a pregnancy meaningless; "prefer not to say" and
 * no answer at all both keep it, because a person can be pregnant without having
 * told this app their sex (widened in M206). `none` normalises to `null` so
 * there is exactly one way to be unset.
 */
function resolveStoredStatus(metrics: BodyMetrics): ReproductiveStatus | null {
  if (metrics.biologicalSex === 'male') return null;
  if (metrics.reproductiveStatus === 'none') return null;
  return metrics.reproductiveStatus;
}

/**
 * Flattens a stored profile's (possibly absent) body-metric keys into
 * `BodyMetrics`, so every reader sees `null` for "not set" whether the row
 * predates v8 or was written after it.
 *
 * @param profile - the stored profile fields, or `null` when never written.
 * @returns the normalised metrics.
 */
export function readBodyMetrics(profile: Partial<BodyMetrics> | null | undefined): BodyMetrics {
  if (!profile) return { ...EMPTY_BODY_METRICS };
  return normalizeBodyMetrics({
    heightCm: profile.heightCm ?? null,
    birthYear: profile.birthYear ?? null,
    biologicalSex: profile.biologicalSex ?? null,
    reproductiveStatus: profile.reproductiveStatus ?? null,
    pregnancyDueDate: profile.pregnancyDueDate ?? null,
    lactationStartDate: profile.lactationStartDate ?? null,
  });
}

/** Whether the person has given us any body metric at all (drives "nothing stored yet" copy). */
export function hasAnyBodyMetric(metrics: BodyMetrics): boolean {
  return (
    metrics.heightCm !== null ||
    metrics.birthYear !== null ||
    metrics.biologicalSex !== null ||
    metrics.reproductiveStatus !== null ||
    (metrics.pregnancyDueDate ?? null) !== null ||
    (metrics.lactationStartDate ?? null) !== null
  );
}

/**
 * A stable string identity for a set of metrics, used as the React `key` on the
 * settings card so the form REMOUNTS whenever the stored metrics change.
 *
 * That is the whole fix for "Remove these details wiped the store but the
 * inputs still showed 178 / 1990 / Female": the fields are uncontrolled
 * (Conform seeds them from `defaultValue`), so a later prop change cannot move
 * them — only a remount can. Keying off the loader data is React's own answer
 * to resetting state on a prop change, and it keeps the card free of the
 * `useEffect`-reset that `.claude/react-rules.md` rules out.
 *
 * @param metrics - the stored metrics.
 * @returns a string that changes if and only if one of the stored values does.
 */
export function bodyMetricsFormKey(metrics: BodyMetrics): string {
  return [
    metrics.heightCm,
    metrics.birthYear,
    metrics.biologicalSex,
    metrics.reproductiveStatus,
    metrics.pregnancyDueDate ?? null,
    metrics.lactationStartDate ?? null,
  ]
    .map((value) => (value === null ? '' : String(value)))
    .join('|');
}

////////////////////////////////////////////////////////////////////////////////
// Form submission — shared by the onboarding step and the settings card
////////////////////////////////////////////////////////////////////////////////

/** The two free-text fields on the body-metrics form (the other two are radio groups). */
export const BODY_NUMERIC_FIELDS = ['heightCm', 'birthYear'] as const;

export type BodyNumericField = (typeof BODY_NUMERIC_FIELDS)[number];

/** The two date fields, revealed by the reproductive-status chips (M206/02). */
export const BODY_DATE_FIELDS = ['pregnancyDueDate', 'lactationStartDate'] as const;

export type BodyDateField = (typeof BODY_DATE_FIELDS)[number];

/** Every field that can carry an inline error: the two numbers and the two dates. */
export type BodyErrorField = BodyNumericField | BodyDateField;

/** i18n KEYS (not copy) for a field that was filled in but can't be read. */
export const BODY_HEIGHT_INVALID_KEY = 'bodyMetrics.errors.height';
export const BODY_BIRTH_YEAR_INVALID_KEY = 'bodyMetrics.errors.birthYear';

/** The raw strings a body-metrics form submits. */
export interface BodyMetricsFormValues {
  heightCm: string | null | undefined;
  birthYear: string | null | undefined;
  biologicalSex: string | null | undefined;
  reproductiveStatus: string | null | undefined;
  /** Optional keys: the onboarding step predates them and submits neither. */
  pregnancyDueDate?: string | null | undefined;
  lactationStartDate?: string | null | undefined;
}

export interface BodyMetricsSubmission {
  /** The parsed metrics; every `null` means "not given", never a fabricated value. */
  values: BodyMetrics;
  /** i18n keys per field that was filled in but unreadable; empty when the form is fine. */
  errors: Partial<Record<BodyErrorField, string>>;
}

/**
 * Decides what a body-metrics form submission means. Shared by the onboarding
 * step and the settings card so the two can never disagree about what a typed
 * height is.
 *
 * Same shape — and same reasoning — as `validateWeightStep` in
 * `#app/lib/onboarding`: blank stays optional (every field here is), but a
 * field the person FILLED IN that can't be read is an error to show rather than
 * a silent `null` indistinguishable from "declined". The two radio groups can't
 * be unreadable — an unrecognised value is simply "no answer", which is a
 * legitimate answer here.
 *
 * @param raw - the raw form values, keyed by field name.
 * @param options.currentYear - the year to measure ages against.
 * @param options.today - the day to measure the two dates against.
 * @returns the parsed metrics plus any per-field error keys.
 */
export function validateBodyMetricsForm(
  raw: BodyMetricsFormValues,
  { currentYear, today }: { currentYear: number; today: Date },
): BodyMetricsSubmission {
  const errors: Partial<Record<BodyErrorField, string>> = {};

  const heightCm = parseHeightCm(raw.heightCm);
  if (trimmedOrNull(raw.heightCm) !== null && heightCm === null) errors.heightCm = BODY_HEIGHT_INVALID_KEY;

  const birthYear = parseBirthYear(raw.birthYear, { currentYear });
  if (trimmedOrNull(raw.birthYear) !== null && birthYear === null) errors.birthYear = BODY_BIRTH_YEAR_INVALID_KEY;

  const dueDate = inspectPregnancyDueDate(raw.pregnancyDueDate, { today });
  if (dueDate.kind === 'rejected') errors.pregnancyDueDate = reproductiveDateErrorKey(dueDate.reason);

  const startDate = inspectLactationStartDate(raw.lactationStartDate, { today });
  if (startDate.kind === 'rejected') errors.lactationStartDate = reproductiveDateErrorKey(startDate.reason);

  const values = normalizeBodyMetrics({
    heightCm,
    birthYear,
    biologicalSex: parseBiologicalSex(raw.biologicalSex),
    reproductiveStatus: parseReproductiveStatus(raw.reproductiveStatus),
    pregnancyDueDate: dueDate.kind === 'date' ? dueDate.value : null,
    lactationStartDate: startDate.kind === 'date' ? startDate.value : null,
  });
  return { values, errors };
}

/**
 * Whether a submission has anything to show the person before it can be saved.
 *
 * @param submission - the result of `validateBodyMetricsForm`.
 * @returns `true` when at least one field was filled in but unreadable.
 */
export function hasBodyMetricsErrors(submission: BodyMetricsSubmission): boolean {
  const fields: readonly BodyErrorField[] = [...BODY_NUMERIC_FIELDS, ...BODY_DATE_FIELDS];
  return fields.some((field) => submission.errors[field] !== undefined);
}

////////////////////////////////////////////////////////////////////////////////
// Age + age band
////////////////////////////////////////////////////////////////////////////////

/**
 * Whole years old, from the birth year alone. Deliberately imprecise by up to
 * a year — see `LocalProfileGoals.birthYear` for why the birth DATE is not
 * collected. The age bands are five years wide at their narrowest, so the
 * imprecision only ever matters on a band boundary, and being one band out for
 * part of a year is a far smaller cost than holding someone's birthday.
 *
 * @param input - the stored birth year and the year to measure against.
 * @returns the age in whole years, or `null` when the birth year is unset.
 */
export function deriveAgeYears({
  birthYear,
  currentYear,
}: {
  birthYear: number | null;
  currentYear: number;
}): number | null {
  if (birthYear === null) return null;
  const age = currentYear - birthYear;
  if (age < MIN_AGE_YEARS || age > MAX_AGE_YEARS) return null;
  return age;
}

/**
 * The reference-intake age bands, exactly as the upstream data segments them
 * (`GlobalNutrient.eu`/`.us` in lowcarbcheck). There is no band below 14-18 —
 * that is the source's shape, not an omission to fill in.
 */
export const RDA_AGE_BANDS = ['14-18', '19-30', '31-50', '51-70', 'over_70'] as const;

export type RdaAgeBand = (typeof RDA_AGE_BANDS)[number];

/** Inclusive upper bound of each band, in years; the last band has none. */
const AGE_BAND_UPPER_BOUNDS: readonly { band: RdaAgeBand; maxAge: number | null }[] = [
  { band: '14-18', maxAge: 18 },
  { band: '19-30', maxAge: 30 },
  { band: '31-50', maxAge: 50 },
  { band: '51-70', maxAge: 70 },
  { band: 'over_70', maxAge: null },
];

/**
 * The reference-intake age band an age falls in, or `null` when the age is
 * unknown or below the youngest band the source data covers.
 *
 * @param ageYears - the age in whole years, or `null`.
 * @returns the matching band, or `null`.
 */
export function resolveRdaAgeBand(ageYears: number | null): RdaAgeBand | null {
  if (ageYears === null || ageYears < MIN_AGE_YEARS) return null;
  const match = AGE_BAND_UPPER_BOUNDS.find(({ maxAge }) => maxAge === null || ageYears <= maxAge);
  return match ? match.band : null;
}

/**
 * The band for a stored birth year, in one call — the shape the (spec 05)
 * micronutrient lookup will actually want.
 *
 * @param input - the stored birth year and the year to measure against.
 * @returns the matching band, or `null` when unset or out of range.
 */
export function resolveAgeBandForBirthYear(input: {
  birthYear: number | null;
  currentYear: number;
}): RdaAgeBand | null {
  return resolveRdaAgeBand(deriveAgeYears(input));
}

////////////////////////////////////////////////////////////////////////////////
// Energy estimate (Mifflin-St Jeor)
////////////////////////////////////////////////////////////////////////////////

/**
 * Mifflin-St Jeor resting-metabolic-rate equation:
 *   BMR = 10 × weight(kg) + 6.25 × height(cm) − 5 × age(years) + s
 *   where s = +5 for male, −161 for female.
 *
 * Source: Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO,
 * "A new predictive equation for resting energy expenditure in healthy
 * individuals", Am J Clin Nutr 1990;51(2):241-247.
 *
 * Chosen over Harris-Benedict because it is the more accurate of the two on
 * modern populations and is what most nutrition references now default to. It
 * is a population-level estimate — two people with identical inputs genuinely
 * differ — which is precisely why what it produces is offered as a chip to tap,
 * never written into a goal on the person's behalf.
 */
const SEX_OFFSET_KCAL = { male: 5, female: -161 } satisfies Record<BiologicalSex, number>;

/**
 * The activity multiplier applied to BMR to reach a daily estimate. Activity
 * level is deliberately NOT one of the stored body metrics (M135 scopes four
 * fields, and asking for a fifth to sharpen a suggestion the person can just
 * type over is a bad trade), so one fixed, DISCLOSED factor is used instead —
 * the copy names it, so the number is never presented as more personal than it
 * is. 1.375 is the conventional "lightly active" multiplier.
 */
export const LIGHTLY_ACTIVE_FACTOR = 1.375;

/** Every input the energy estimate needs. Any `null` means no estimate at all. */
export interface EnergyEstimateInput {
  weightKg: number | null;
  heightCm: number | null;
  biologicalSex: BiologicalSex | null;
  birthYear: number | null;
  currentYear: number;
}

/**
 * Resting energy expenditure in kcal/day, or `null` when any input is missing.
 * Degrading to `null` — rather than substituting an average — is the whole
 * contract: a suggestion built on a guessed height is worse than no suggestion.
 *
 * @param input - weight, height, sex and birth year, plus the year to age against.
 * @returns kcal/day rounded to a whole number, or `null`.
 */
export function computeBmrKcal(input: EnergyEstimateInput): number | null {
  const { weightKg, heightCm, biologicalSex } = input;
  if (weightKg === null || weightKg <= 0) return null;
  if (heightCm === null || heightCm <= 0) return null;
  if (biologicalSex === null) return null;
  const ageYears = deriveAgeYears({ birthYear: input.birthYear, currentYear: input.currentYear });
  if (ageYears === null) return null;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears + SEX_OFFSET_KCAL[biologicalSex];
  if (!Number.isFinite(bmr) || bmr <= 0) return null;
  return Math.round(bmr);
}

/**
 * Daily energy expenditure in kcal/day — BMR × the disclosed activity factor —
 * or `null` when BMR is unavailable.
 *
 * @param input - the energy inputs, plus an optional activity factor override.
 * @returns kcal/day rounded to a whole number, or `null`.
 */
export function computeTdeeKcal(input: EnergyEstimateInput & { activityFactor?: number }): number | null {
  const bmr = computeBmrKcal(input);
  if (bmr === null) return null;
  const factor = input.activityFactor ?? LIGHTLY_ACTIVE_FACTOR;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return Math.round(bmr * factor);
}

/** Rounding step for the suggested target — a tappable estimate that reads as an estimate. */
const KCAL_SUGGESTION_STEP = 10;

/**
 * The daily calorie figure offered as a one-tap chip: the TDEE estimate,
 * rounded to the nearest 10 kcal so it never wears a false three-digit
 * precision. `null` whenever any input is missing, which is the "no suggestion"
 * state every caller must handle.
 *
 * Deliberately NOT a deficit or a surplus: openplate does not know, and will
 * not assume, what the person is trying to do with their weight.
 *
 * @param input - the energy inputs.
 * @returns a suggested kcal/day target, or `null`.
 */
export function suggestDailyKcal(input: EnergyEstimateInput): number | null {
  const tdee = computeTdeeKcal(input);
  if (tdee === null) return null;
  return Math.round(tdee / KCAL_SUGGESTION_STEP) * KCAL_SUGGESTION_STEP;
}

////////////////////////////////////////////////////////////////////////////////
// Protein floor
////////////////////////////////////////////////////////////////////////////////

/**
 * Grams of protein per kilogram of REFERENCE mass. The factor is unchanged from
 * the day the goals page first offered a protein chip; what changed in M200 is
 * only the mass it multiplies, so the constant moved here, next to the equation
 * that now supplies that mass, and stays a single named value.
 */
export const PROTEIN_PER_KG = 1.6;

/**
 * Devine ideal body weight, in metric:
 *   idealWeightKg = base + 2.3 x (heightCm - 152.4) / 2.54
 *   base = 50.0 kg for male, 45.5 kg for female
 *
 * Source: Devine BJ, "Gentamicin therapy", Drug Intelligence and Clinical
 * Pharmacy 1974;8:650-655.
 *
 * It is honestly a 1974 drug-dosing formula rather than a nutrition one, and
 * nothing here pretends otherwise. What earns it a place is narrower and
 * sufficient: it is a published, sex-segmented mapping from height to a
 * reference mass, it is the mapping clinicians already reach for when they want
 * a basis that does not move with fat mass, and it is arithmetic a person can
 * check by hand.
 *
 * Why a reference mass at all: a protein floor scaled by TOTAL body weight
 * rises with fat mass, so the heavier a person is the more protein the app
 * demands, which is the opposite of what the number is for.
 */
const DEVINE_BASE_KG = { male: 50, female: 45.5 } satisfies Record<BiologicalSex, number>;

/** Five feet in centimetres: the height at which Devine is exactly the base mass. */
const DEVINE_BASE_HEIGHT_CM = 152.4;

/** One inch in centimetres, the unit Devine's slope is written in. */
const CM_PER_INCH = 2.54;

/** Kilograms Devine adds per inch of height above the base height. */
const DEVINE_KG_PER_INCH = 2.3;

/** The two optional profile fields Devine needs. Either one missing means no answer. */
export interface IdealWeightInput {
  heightCm: number | null;
  biologicalSex: BiologicalSex | null;
}

/**
 * Devine ideal body weight in kilograms, or `null` when it cannot be computed.
 *
 * Below `DEVINE_BASE_HEIGHT_CM` the formula degrades: it trends toward, and
 * eventually past, zero. It is deliberately NOT extrapolated down there. A
 * shorter person gets `null`, and the caller's honest fallback, rather than a
 * figure the equation was never fitted for.
 *
 * @param input - height in centimetres and biological sex, either possibly null.
 * @returns kilograms, unrounded, or `null`.
 */
export function computeDevineIdealWeightKg(input: IdealWeightInput): number | null {
  const { heightCm, biologicalSex } = input;
  if (heightCm === null || !Number.isFinite(heightCm)) return null;
  if (biologicalSex === null) return null;
  if (heightCm < DEVINE_BASE_HEIGHT_CM) return null;
  const idealWeightKg =
    DEVINE_BASE_KG[biologicalSex] + (DEVINE_KG_PER_INCH * (heightCm - DEVINE_BASE_HEIGHT_CM)) / CM_PER_INCH;
  if (!Number.isFinite(idealWeightKg) || idealWeightKg <= 0) return null;
  return idealWeightKg;
}

/** Devine's inputs, plus the g/kg factor, which a caller may override. */
export interface ProteinFloorInput extends IdealWeightInput {
  gramsPerKg?: number;
}

/**
 * The suggested daily protein floor in grams, from height and sex, or `null`
 * when height or sex is missing or the height is outside Devine's range.
 *
 * `null` is a real answer here, not a failure to produce one: there is no
 * default height, no assumed sex and no fallback number inside this function.
 * Saying "I cannot" is the whole reason it can be trusted when it does answer.
 *
 * @param input - height, sex, and optionally a g/kg factor other than 1.6.
 * @returns grams per day rounded to a whole number, or `null`.
 */
export function estimateProteinFloorG(input: ProteinFloorInput): number | null {
  const idealWeightKg = computeDevineIdealWeightKg(input);
  if (idealWeightKg === null) return null;
  const gramsPerKg = input.gramsPerKg ?? PROTEIN_PER_KG;
  if (!Number.isFinite(gramsPerKg) || gramsPerKg <= 0) return null;
  return Math.round(idealWeightKg * gramsPerKg);
}

/**
 * Which basis produced a protein suggestion. The screen NAMES this, so a change
 * of method is visible to the person rather than a target that silently moved.
 */
export type ProteinFloorMethod = 'height' | 'weight';

/** A protein suggestion and the method behind it. There is no unnamed number. */
export interface ProteinFloorSuggestion {
  grams: number;
  method: ProteinFloorMethod;
}

/** Everything the goals chip has to work from: the two profile fields, and the last weigh-in. */
export interface ProteinFloorSuggestionInput extends IdealWeightInput {
  latestWeighInKg: number | null;
}

/**
 * The protein figure the goals chip offers, with its method, or `null` when
 * neither basis has anything to work from.
 *
 * Height and sex are preferred because they do not move with fat mass. The
 * weigh-in rule is the one this page has always used, kept as the fallback so
 * that nobody who has a working suggestion today loses it by declining to give
 * a height or a sex, both of which the app deliberately lets a person skip.
 *
 * @param input - height, sex and the most recent weigh-in, each possibly null.
 * @returns the grams and the method, or `null` for "no suggestion at all".
 */
export function suggestProteinFloor(input: ProteinFloorSuggestionInput): ProteinFloorSuggestion | null {
  const fromHeight = estimateProteinFloorG(input);
  if (fromHeight !== null) return { grams: fromHeight, method: 'height' };
  const { latestWeighInKg } = input;
  if (latestWeighInKg === null || !Number.isFinite(latestWeighInKg) || latestWeighInKg <= 0) return null;
  return { grams: Math.round(PROTEIN_PER_KG * latestWeighInKg), method: 'weight' };
}

////////////////////////////////////////////////////////////////////////////////
// Reference protein floor
////////////////////////////////////////////////////////////////////////////////

/**
 * TWO protein figures live in this file, and they answer different questions.
 *
 * `PROTEIN_PER_KG` (1.6 g/kg, above) is a SUGGESTION for a floor the person
 * then chooses and owns. It is an athletic, muscle-sparing factor, it is
 * offered as a chip to tap on the goals page, and nothing applies it silently.
 *
 * The constants below are a POPULATION REFERENCE the day view falls back
 * to when the person set no protein floor at all, exactly the way
 * `DEFAULT_FIBER_REFERENCE_G` stands in for a fiber goal that has no field.
 * It is the smallest defensible intake for an adult, not a figure to train on,
 * and the row wears a "reference" tag rather than posing as a goal.
 *
 * Never substitute one for the other: swapping them would either double a
 * beginner's floor overnight or halve the suggestion an athlete asked for.
 */

/**
 * EFSA's population reference intake for protein in adults, in grams per
 * kilogram of body weight per day.
 *
 * Source: EFSA Panel on Dietetic Products, Nutrition and Allergies, "Scientific
 * Opinion on Dietary Reference Values for protein", EFSA Journal 2012;10(2):2557.
 */
export const EFSA_PROTEIN_REFERENCE_G_PER_KG = 0.83;

/**
 * The food-labelling reference intake for protein, in grams per day. This is
 * the last resort, for a person who has given neither a weigh-in nor a height
 * and sex, so there is no body mass to scale by at all.
 *
 * Source: Regulation (EU) No 1169/2011, Annex XIII.
 */
export const EU_PROTEIN_REFERENCE_INTAKE_G = 50;

/**
 * Grams of protein EFSA adds for pregnancy, one figure per trimester, on top of
 * whichever basis was used.
 *
 * The trimester comes from the person's own due date, resolved by
 * `resolveGestation` in `#app/lib/reproductive-stage` and passed in. When no due
 * date is on file the largest figure, T3, applies instead, so the floor never
 * sits under what a pregnancy may need. That fallback overstates an early
 * pregnancy on purpose: a floor that is a little high shows a gap that is still
 * there, while one that is too low shows none at all.
 *
 * Source: EFSA Panel on Dietetic Products, Nutrition and Allergies, "Scientific
 * Opinion on Dietary Reference Values for protein", EFSA Journal 2012;10(2):2557.
 */
export const EFSA_PREGNANCY_T1_PROTEIN_ADDITION_G = 1;
/** Grams of protein EFSA adds in the second trimester. See the T1 constant for the source. */
export const EFSA_PREGNANCY_T2_PROTEIN_ADDITION_G = 9;
/** Grams of protein EFSA adds in the third trimester, and the no-due-date fallback. See the T1 constant for the source. */
export const EFSA_PREGNANCY_T3_PROTEIN_ADDITION_G = 28;

/**
 * Grams of protein EFSA adds while lactating, split at six months postpartum.
 *
 * The month count comes from the person's own birth date, resolved by
 * `resolveLactationMonths` and passed in; with no date on file the larger
 * first-six-months figure applies, for the same reason the pregnancy fallback
 * takes T3.
 *
 * Source: EFSA Journal 2012;10(2):2557, as above.
 */
export const EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G = 19;
/** Grams of protein EFSA adds after the first six months of lactation. See the first-six-months constant for the source. */
export const EFSA_LACTATION_PROTEIN_ADDITION_AFTER_6MO_G = 13;

/**
 * Kilocalories EFSA adds for pregnancy, one figure per trimester.
 *
 * These adjust a calorie target the person TYPED IN, and only when they typed
 * one; nothing here invents an energy target for somebody who set none, and
 * `suggestDailyKcal` never reads these constants (M135's locked decision 2 keeps
 * that estimate clear of clinical adjustment).
 *
 * Source: EFSA Panel on Dietetic Products, Nutrition and Allergies, "Scientific
 * Opinion on Dietary Reference Values for energy", EFSA Journal 2013;11(1):3005.
 */
export const EFSA_PREGNANCY_T1_KCAL_ADDITION = 70;
/** Kilocalories EFSA adds in the second trimester. See the T1 constant for the source. */
export const EFSA_PREGNANCY_T2_KCAL_ADDITION = 260;
/** Kilocalories EFSA adds in the third trimester, and the no-due-date fallback. See the T1 constant for the source. */
export const EFSA_PREGNANCY_T3_KCAL_ADDITION = 500;

/**
 * Kilocalories EFSA adds over the first six months of lactation, for exclusive
 * breastfeeding.
 *
 * **There is no after-six-months figure here, and that is a stated gap rather
 * than an oversight.** The milestone that added this constant supplied no
 * published figure for later lactation, where intake depends on how much of the
 * child's diet is still milk, so past six months the addition is `0` until a
 * sourced figure arrives. Zero understates; inventing a number would misstate.
 *
 * Source: EFSA Journal 2013;11(1):3005, as above.
 */
export const EFSA_LACTATION_KCAL_ADDITION_FIRST_6MO = 500;

/**
 * Whole months postpartum at which EFSA's first-lactation-period figures stop
 * applying. A count BELOW this is the first six months; the month it is reached
 * is already "after".
 */
const LACTATION_FIRST_PERIOD_MONTHS = 6;

/**
 * Which body mass, if any, the reference floor was scaled by. The basis is
 * NAMED rather than implied, for the same reason `ProteinFloorMethod` is: a
 * figure whose method cannot be stated is a number nobody can check.
 */
export type ProteinReferenceBasis = 'weigh-in' | 'height' | 'labelling';

/** A reference protein floor in whole grams, and the basis behind it. */
export interface ReferenceProteinFloor {
  grams: number;
  basis: ProteinReferenceBasis;
}

/**
 * The resolved reproductive stage: the status the person picked, plus where in
 * it they are today.
 *
 * `trimester` and `lactationMonths` are RESOLVED BY THE CALLER, with
 * `resolveGestation` / `resolveLactationMonths` from `#app/lib/reproductive-stage`
 * against the device's own day key. Nothing here reads a clock, which is what
 * keeps every stage below pinnable by a `node:test` file.
 *
 * Either one may be `null` while the status is set: the person gave no date, or
 * the date they gave is outside the range the resolver will speak for. Both
 * additions then fall back to the largest figure for that status.
 */
export interface ReproductiveStageInput {
  reproductiveStatus: ReproductiveStatus | null;
  trimester: Trimester | null;
  lactationMonths: number | null;
}

/** Everything the reference floor reads: the last weigh-in, Devine's two fields, and the resolved reproductive stage. */
export interface ReferenceProteinFloorInput extends IdealWeightInput, ReproductiveStageInput {
  latestWeighInKg: number | null;
}

/**
 * The pregnancy or lactation protein addition in grams, or zero when the person
 * is neither.
 *
 * @param stage - the status plus the resolved trimester or month count, either of which may be null.
 * @returns whole grams to add on top of the reference basis.
 */
function proteinAdditionFor(stage: ReproductiveStageInput): number {
  if (stage.reproductiveStatus === 'pregnant') {
    if (stage.trimester === 1) return EFSA_PREGNANCY_T1_PROTEIN_ADDITION_G;
    if (stage.trimester === 2) return EFSA_PREGNANCY_T2_PROTEIN_ADDITION_G;
    // T3, and the no-due-date fallback: the largest figure of the three.
    return EFSA_PREGNANCY_T3_PROTEIN_ADDITION_G;
  }
  if (stage.reproductiveStatus === 'lactating') {
    const { lactationMonths } = stage;
    if (lactationMonths !== null && lactationMonths >= LACTATION_FIRST_PERIOD_MONTHS) {
      return EFSA_LACTATION_PROTEIN_ADDITION_AFTER_6MO_G;
    }
    // The first six months, and the no-birth-date fallback: the larger figure.
    return EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G;
  }
  return 0;
}

/**
 * The pregnancy or lactation energy addition in whole kilocalories, or zero when
 * the person is neither.
 *
 * Past six months of lactation this answers `0`, the stated gap
 * `EFSA_LACTATION_KCAL_ADDITION_FIRST_6MO` documents, and not a figure this app
 * made up.
 *
 * @param stage - the status plus the resolved trimester or month count, either of which may be null.
 * @returns whole kilocalories to add to a calorie target the person set.
 */
function kcalAdditionFor(stage: ReproductiveStageInput): number {
  if (stage.reproductiveStatus === 'pregnant') {
    if (stage.trimester === 1) return EFSA_PREGNANCY_T1_KCAL_ADDITION;
    if (stage.trimester === 2) return EFSA_PREGNANCY_T2_KCAL_ADDITION;
    // T3, and the no-due-date fallback: the largest figure of the three.
    return EFSA_PREGNANCY_T3_KCAL_ADDITION;
  }
  if (stage.reproductiveStatus === 'lactating') {
    const { lactationMonths } = stage;
    if (lactationMonths !== null && lactationMonths >= LACTATION_FIRST_PERIOD_MONTHS) return 0;
    return EFSA_LACTATION_KCAL_ADDITION_FIRST_6MO;
  }
  return 0;
}

/**
 * The pregnancy or lactation energy addition, in whole kilocalories, or `null`
 * when there is no addition to make at all.
 *
 * `null` and `0` say different things here, and the caller must be able to tell
 * them apart. `null` means "this person is neither pregnant nor lactating, so no
 * adjustment applies"; `0` means "an adjustment applies but the published figure
 * for this stage is zero or unknown", today only lactation past six months,
 * which `EFSA_LACTATION_KCAL_ADDITION_FIRST_6MO` documents as a gap in the
 * source rather than a decision by this app.
 *
 * The addition lands on a calorie target the person TYPED IN, and only when they
 * typed one. `suggestDailyKcal` is a different mechanism and stays untouched: it
 * invents an energy figure from scratch, and M135's locked decision 2 keeps that
 * estimate out of clinical adjustment. Nothing is written back to storage; the
 * raw target the person set is what the goals page still shows and stores.
 *
 * @param input - the status plus the resolved trimester or month count.
 * @returns whole kilocalories, or `null` for status `'none'` and for no status at all.
 */
export function computeReferenceKcalAddition(input: ReproductiveStageInput): number | null {
  const { reproductiveStatus } = input;
  if (reproductiveStatus !== 'pregnant' && reproductiveStatus !== 'lactating') return null;
  return kcalAdditionFor(input);
}

/**
 * The one date that would make both additions follow the person's real stage,
 * or `null` when nothing is missing.
 *
 * This is the difference between "the app used a published reference" and "the
 * app used the LARGEST published reference because it does not know how far
 * along you are", which is the distinction the day view's reference tag exists
 * to draw. Shared rather than repeated per route, so the diary and the dashboard
 * cannot disagree about when that tag appears.
 *
 * @param stage - the status plus whatever the resolvers made of the stored dates.
 * @returns `'due-date'`, `'birth-date'`, or `null`.
 */
export function selectMissingReferenceDate(stage: ReproductiveStageInput): MissingReferenceDate | null {
  if (stage.reproductiveStatus === 'pregnant' && stage.trimester === null) return 'due-date';
  if (stage.reproductiveStatus === 'lactating' && stage.lactationMonths === null) return 'birth-date';
  return null;
}

/**
 * The reference protein floor, in whole grams, with the basis that produced it.
 *
 * Unlike `estimateProteinFloorG` and `suggestProteinFloor`, this one ALWAYS
 * answers. That is the point of it: it stands in for a floor the person never
 * set, so "I cannot say" would leave the protein row with no target at all,
 * which is the state this function exists to end.
 *
 * The fallback order, and why:
 * 1. the latest weigh-in, because a real measurement beats an estimate;
 * 2. `computeDevineIdealWeightKg` from height and sex, the same reference mass
 *    `estimateProteinFloorG` scales, for a person who weighs themselves
 *    nowhere but filled in the body-metrics card;
 * 3. `EU_PROTEIN_REFERENCE_INTAKE_G`, the flat labelling figure, for a person
 *    who gave neither.
 *
 * The pregnancy or lactation addition applies on top of whichever basis won, at
 * the figure for the stage the caller resolved. With no date to resolve one from,
 * it is the largest figure for the status, which is what this function did for
 * every pregnancy before a due date could be recorded.
 *
 * @param input - the latest weigh-in, height, sex and resolved reproductive stage, each field possibly null.
 * @returns whole grams per day, and the basis, never null.
 */
export function computeReferenceProteinFloor(input: ReferenceProteinFloorInput): ReferenceProteinFloor {
  const additionG = proteinAdditionFor(input);
  const { latestWeighInKg } = input;

  if (latestWeighInKg !== null && Number.isFinite(latestWeighInKg) && latestWeighInKg > 0) {
    return { grams: Math.round(latestWeighInKg * EFSA_PROTEIN_REFERENCE_G_PER_KG + additionG), basis: 'weigh-in' };
  }

  const referenceMassKg = computeDevineIdealWeightKg(input);
  if (referenceMassKg !== null) {
    return { grams: Math.round(referenceMassKg * EFSA_PROTEIN_REFERENCE_G_PER_KG + additionG), basis: 'height' };
  }

  return { grams: Math.round(EU_PROTEIN_REFERENCE_INTAKE_G + additionG), basis: 'labelling' };
}

/** The two fields a weigh-in row needs for "which one is the latest". */
export interface WeighInDay {
  dayKey: string;
  weightKg: number;
}

/**
 * The most recent weigh-in in kilograms, or `null` when there are none.
 *
 * `dayKey` IS the calendar day a weigh-in belongs to, one entry per day, so the
 * newest key is the latest measurement. Shared rather than re-sorted per route,
 * because "the latest weigh-in" must mean the same thing on every screen that
 * scales a target by body mass.
 *
 * @param entries - weigh-in rows in any order.
 * @returns kilograms, or `null`.
 */
export function selectLatestWeighInKg(entries: readonly WeighInDay[]): number | null {
  let latest: WeighInDay | null = null;
  for (const entry of entries) {
    if (latest === null || entry.dayKey > latest.dayKey) latest = entry;
  }
  return latest === null ? null : latest.weightKg;
}
