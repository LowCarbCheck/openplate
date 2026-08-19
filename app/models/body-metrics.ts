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
 * `PROTEIN_PER_KG` already does on the goals page. It is an estimate of energy
 * expenditure, not a prescription, and DESIGN.md §10.1 forbids copy that turns
 * it into one. Pregnancy and lactation deliberately do NOT adjust it: those are
 * clinical adjustments and this is a food log, not a blood panel (M135's locked
 * decision 2).
 */
import type { BiologicalSex, ReproductiveStatus } from '#app/lib/local-store/schema';

////////////////////////////////////////////////////////////////////////////////
// Shape
////////////////////////////////////////////////////////////////////////////////

/**
 * The four optional body metrics, flattened off `LocalProfileGoals` into the
 * shape the forms and the derivations pass around. Every field is nullable and
 * `null` always means "not told us" — an absent key on the stored profile reads
 * back as `null` here (see `readBodyMetrics`).
 */
export interface BodyMetrics {
  heightCm: number | null;
  birthYear: number | null;
  biologicalSex: BiologicalSex | null;
  reproductiveStatus: ReproductiveStatus | null;
}

/** The "told us nothing" metrics — what every reader sees before onboarding. */
export const EMPTY_BODY_METRICS: BodyMetrics = {
  heightCm: null,
  birthYear: null,
  biologicalSex: null,
  reproductiveStatus: null,
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
// Normalisation
////////////////////////////////////////////////////////////////////////////////

/**
 * The one place the sex ↔ reproductive-status invariant is enforced: a stored
 * pregnancy/lactation status only survives while `biologicalSex === 'female'`.
 * Switching sex, or clearing it back to "prefer not to say", drops the status
 * rather than leaving it stranded in the store where no screen would ever show
 * it again — a hidden answer the person cannot see is one they cannot withdraw.
 *
 * `none` is normalised to `null` for the same reason: they mean the same thing
 * and storing both invites two readers to disagree about which is "unset".
 *
 * @param metrics - the metrics as entered.
 * @returns the metrics with the invariant applied.
 */
export function normalizeBodyMetrics(metrics: BodyMetrics): BodyMetrics {
  if (metrics.biologicalSex !== 'female') return { ...metrics, reproductiveStatus: null };
  if (metrics.reproductiveStatus === 'none') return { ...metrics, reproductiveStatus: null };
  return { ...metrics };
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
  });
}

/** Whether the person has given us any body metric at all (drives "nothing stored yet" copy). */
export function hasAnyBodyMetric(metrics: BodyMetrics): boolean {
  return (
    metrics.heightCm !== null ||
    metrics.birthYear !== null ||
    metrics.biologicalSex !== null ||
    metrics.reproductiveStatus !== null
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
 * @returns a string that changes if and only if one of the four values does.
 */
export function bodyMetricsFormKey(metrics: BodyMetrics): string {
  return [metrics.heightCm, metrics.birthYear, metrics.biologicalSex, metrics.reproductiveStatus]
    .map((value) => (value === null ? '' : String(value)))
    .join('|');
}

////////////////////////////////////////////////////////////////////////////////
// Form submission — shared by the onboarding step and the settings card
////////////////////////////////////////////////////////////////////////////////

/** The two free-text fields on the body-metrics form (the other two are radio groups). */
export const BODY_NUMERIC_FIELDS = ['heightCm', 'birthYear'] as const;

export type BodyNumericField = (typeof BODY_NUMERIC_FIELDS)[number];

/** i18n KEYS (not copy) for a field that was filled in but can't be read. */
export const BODY_HEIGHT_INVALID_KEY = 'bodyMetrics.errors.height';
export const BODY_BIRTH_YEAR_INVALID_KEY = 'bodyMetrics.errors.birthYear';

/** The raw strings a body-metrics form submits. */
export interface BodyMetricsFormValues {
  heightCm: string | null | undefined;
  birthYear: string | null | undefined;
  biologicalSex: string | null | undefined;
  reproductiveStatus: string | null | undefined;
}

export interface BodyMetricsSubmission {
  /** The parsed metrics; every `null` means "not given", never a fabricated value. */
  values: BodyMetrics;
  /** i18n keys per free-text field that was filled in but unreadable; empty when the form is fine. */
  errors: Partial<Record<BodyNumericField, string>>;
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
 * @param options - the year to measure ages against.
 * @returns the parsed metrics plus any per-field error keys.
 */
export function validateBodyMetricsForm(
  raw: BodyMetricsFormValues,
  { currentYear }: { currentYear: number },
): BodyMetricsSubmission {
  const errors: Partial<Record<BodyNumericField, string>> = {};

  const heightCm = parseHeightCm(raw.heightCm);
  if (trimmedOrNull(raw.heightCm) !== null && heightCm === null) errors.heightCm = BODY_HEIGHT_INVALID_KEY;

  const birthYear = parseBirthYear(raw.birthYear, { currentYear });
  if (trimmedOrNull(raw.birthYear) !== null && birthYear === null) errors.birthYear = BODY_BIRTH_YEAR_INVALID_KEY;

  const values = normalizeBodyMetrics({
    heightCm,
    birthYear,
    biologicalSex: parseBiologicalSex(raw.biologicalSex),
    reproductiveStatus: parseReproductiveStatus(raw.reproductiveStatus),
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
  return BODY_NUMERIC_FIELDS.some((field) => submission.errors[field] !== undefined);
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
