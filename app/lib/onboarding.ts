import type { TrackingFocusType } from '#types/enums';
import { isValidTimeZone } from '#app/lib/user-days';
import { parseDisplayWeightToKg } from '#app/lib/weight-units';

/**
 * Pure onboarding-flow logic — step ordering, goal-preset mapping, and the
 * form-value parsers the `/onboarding` route relies on. No DB, no React, no
 * server-only imports, so it's shared by the loader, the action, and the client
 * component and is directly unit-testable (mirrors `#app/lib/user-days`).
 *
 * Never fabricate a goal: a blank/invalid numeric field resolves to `null`
 * ("no goal"), never `0` — a `0` net-carb ceiling or kcal target would be a
 * meaningful, wrong value.
 */

////////////////////////////////////////////////////////////////////////////////
// Steps
////////////////////////////////////////////////////////////////////////////////

/**
 * Ordered onboarding step identifiers, in the order the user walks them.
 *
 * `body` (M135) sits after `weight` because it reuses the weigh-in the previous
 * step may just have captured, and before `first-food` because that step is the
 * flow's only exit. It is entirely optional — Skip advances past it like any
 * other step, and nothing downstream requires what it collects.
 */
export const ONBOARDING_STEPS = ['focus', 'weight', 'body', 'first-food'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Parses a raw `?step=` value into a valid step, defaulting to the first when
 * absent or unrecognized — so a refresh, a hand-typed URL, or a stale bookmark
 * always lands on a real step rather than a blank screen.
 *
 * @param raw - the raw `?step=` query value.
 * @returns a valid onboarding step.
 */
export function parseOnboardingStep(raw: string | null | undefined): OnboardingStep {
  return ONBOARDING_STEPS.find((step) => step === raw) ?? ONBOARDING_STEPS[0];
}

/**
 * The step after `step`, or `null` when `step` is the last one.
 *
 * @param step - the current step.
 * @returns the next step, or `null` at the end of the flow.
 */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1];
  return next ?? null;
}

/**
 * The 1-based position of `step`, for progress dots / "step N of M" copy.
 *
 * @param step - the step to locate.
 * @returns its 1-based index in the flow.
 */
export function onboardingStepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

////////////////////////////////////////////////////////////////////////////////
// Tracking focus
////////////////////////////////////////////////////////////////////////////////

/** Selectable tracking-focus values (mirrors `TrackingFocusType`). */
export const TRACKING_FOCUS_VALUES = ['net-carbs', 'calories', 'habit'] as const;

/**
 * Narrows a raw form value to a valid tracking focus, or `null` when the user
 * made no valid choice (so an absent focus stays "unchosen", never guessed).
 *
 * @param raw - the raw form value.
 * @returns a valid `TrackingFocusType`, or `null`.
 */
export function parseTrackingFocus(raw: string | null | undefined): TrackingFocusType | null {
  return TRACKING_FOCUS_VALUES.find((focus) => focus === raw) ?? null;
}

////////////////////////////////////////////////////////////////////////////////
// Net-carb goal presets
////////////////////////////////////////////////////////////////////////////////

/**
 * A translation lookup, passed in explicitly wherever this module needs user-
 * facing text (M129/05). This file is pure and unit-tested outside React, so
 * it must never reach for the i18next singleton itself — the caller owns the
 * language, and a test can hand in a fake.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * A one-tap net-carb goal preset. `ceiling === null` means "decide later" (no
 * goal). The chip's name and its one-line explanation are i18n KEYS, not copy,
 * so this table stays language-agnostic.
 */
export interface CarbPreset {
  id: string;
  labelKey: string;
  detailKey: string;
  /** Daily net-carb ceiling in grams, or `null` for no goal. */
  ceiling: number | null;
}

/** The preset chips shown when the user picks the net-carbs focus. */
export const CARB_PRESETS: readonly CarbPreset[] = [
  {
    id: 'keto',
    labelKey: 'onboarding.carbPreset.keto.label',
    detailKey: 'onboarding.carbPreset.keto.detail',
    ceiling: 20,
  },
  {
    id: 'low-carb',
    labelKey: 'onboarding.carbPreset.lowCarb.label',
    detailKey: 'onboarding.carbPreset.lowCarb.detail',
    ceiling: 50,
  },
  {
    id: 'moderate',
    labelKey: 'onboarding.carbPreset.moderate.label',
    detailKey: 'onboarding.carbPreset.moderate.detail',
    ceiling: 100,
  },
  {
    id: 'later',
    labelKey: 'onboarding.carbPreset.later.label',
    detailKey: 'onboarding.carbPreset.later.detail',
    ceiling: null,
  },
];

/**
 * Resolves a preset id to its net-carb ceiling. An unknown id (or the
 * "decide later" preset) resolves to `null` — no goal, never a fabricated `0`.
 *
 * @param presetId - the selected preset id.
 * @returns the ceiling in grams, or `null`.
 */
export function carbCeilingForPreset(presetId: string | null | undefined): number | null {
  const preset = CARB_PRESETS.find((candidate) => candidate.id === presetId);
  return preset ? preset.ceiling : null;
}

/**
 * The preset id whose ceiling matches `ceiling`, for pre-selecting a chip when
 * a returning user already has a goal. A ceiling that matches no preset (or a
 * `null` goal) falls back to `later`.
 *
 * @param ceiling - the stored net-carb ceiling, or `null`.
 * @returns the matching preset id.
 */
export function presetIdForCeiling(ceiling: number | null): string {
  if (ceiling === null) return 'later';
  const preset = CARB_PRESETS.find((candidate) => candidate.ceiling === ceiling);
  return preset ? preset.id : 'later';
}

////////////////////////////////////////////////////////////////////////////////
// Numeric field parsers
////////////////////////////////////////////////////////////////////////////////

/** Upper bound for a daily kcal target — fits `goal_kcal_target numeric(6,2)` and stays realistic. */
const MAX_KCAL_TARGET = 9999;

/** Upper bound for a body weight in kg — fits `weight_kg numeric(5,2)` (max 999.99). */
const MAX_WEIGHT_KG = 999;

/**
 * Parses an optional kcal-target field. Blank, non-numeric, non-positive, or
 * out-of-range input resolves to `null` (no goal) rather than `0`.
 *
 * @param raw - the raw form value.
 * @returns a whole-number kcal target, or `null`.
 */
export function parseKcalTarget(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_KCAL_TARGET) return null;
  return Math.round(value);
}

/**
 * Parses an optional body-weight field (kg). Blank, non-numeric, non-positive,
 * or out-of-range input resolves to `null`. Rounded to 2 decimals to fit the
 * `numeric(_, 2)` columns.
 *
 * Delegates the number reading to `#app/lib/weight-units`'s
 * `parseDisplayWeightToKg` so there is exactly ONE place in the app that
 * decides what a typed weight means — the two used to duplicate a bare
 * `Number()` and both choked on a decimal comma. This adds only the stored-
 * column upper bound on top.
 *
 * A `null` here means "no weight", NOT "the input was fine" — a filled-in
 * field that lands on `null` is a mistake to surface, which is what
 * `validateWeightStep` below is for.
 *
 * @param raw - the raw form value.
 * @returns a weight in kg (2-decimal precision), or `null`.
 */
export function parseWeightKg(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const kg = parseDisplayWeightToKg(raw, 'kg');
  if (kg === null || kg > MAX_WEIGHT_KG) return null;
  return kg;
}

////////////////////////////////////////////////////////////////////////////////
// Weight step validation
////////////////////////////////////////////////////////////////////////////////

/** The two weight fields the `weight` step submits, both in kilograms. */
export const WEIGHT_STEP_FIELDS = ['currentWeightKg', 'targetWeightKg'] as const;

export type WeightStepField = (typeof WEIGHT_STEP_FIELDS)[number];

/** i18n KEY (not copy) for a weight field that was filled in but doesn't read as a number. */
export const WEIGHT_NOT_A_NUMBER_KEY = 'onboarding.weight.errors.notANumber';

export interface WeightStepSubmission {
  /** The parsed kilograms per field; `null` means "not given" (blank). */
  values: Record<WeightStepField, number | null>;
  /** i18n keys per field that was filled in but unreadable; empty when the step is fine. */
  errors: Partial<Record<WeightStepField, string>>;
}

/** One weight field's outcome: its kilograms, or the error key when it was filled in but unreadable. */
interface WeightFieldOutcome {
  kg: number | null;
  errorKey: string | null;
}

/** Reads one submitted weight field. Blank is not an error — it means "not given". */
function readWeightField(raw: string | null | undefined): WeightFieldOutcome {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return { kg: null, errorKey: null };
  const kg = parseWeightKg(trimmed);
  return kg === null ? { kg: null, errorKey: WEIGHT_NOT_A_NUMBER_KEY } : { kg, errorKey: null };
}

/**
 * Decides what the weight step should do with what was submitted.
 *
 * Blank stays optional — the weigh-in is skipped and a blank target clears the
 * goal, exactly as before. The bug this exists to prevent is the OTHER case:
 * a field the user filled in that doesn't parse (a decimal comma, a typo, a
 * weight past the stored range) used to resolve to `null` too, which was
 * indistinguishable from blank — so the step saved nothing, said nothing, and
 * advanced. A filled-in field that can't be read is now an error the caller
 * must show before moving on.
 *
 * @param raw - the raw form values, keyed by field name.
 * @returns the parsed values plus any per-field error keys.
 */
export function validateWeightStep(raw: Record<WeightStepField, string | null | undefined>): WeightStepSubmission {
  const current = readWeightField(raw.currentWeightKg);
  const target = readWeightField(raw.targetWeightKg);
  const errors: Partial<Record<WeightStepField, string>> = {};
  if (current.errorKey !== null) errors.currentWeightKg = current.errorKey;
  if (target.errorKey !== null) errors.targetWeightKg = target.errorKey;
  return { values: { currentWeightKg: current.kg, targetWeightKg: target.kg }, errors };
}

/**
 * Whether a weight-step submission has anything to show the user before it can
 * be saved.
 *
 * @param submission - the result of `validateWeightStep`.
 * @returns `true` when at least one field was filled in but unreadable.
 */
export function hasWeightStepErrors(submission: WeightStepSubmission): boolean {
  return WEIGHT_STEP_FIELDS.some((field) => submission.errors[field] !== undefined);
}

////////////////////////////////////////////////////////////////////////////////
// Timezone + exit destination
////////////////////////////////////////////////////////////////////////////////

/**
 * Resolves a browser-provided IANA time-zone name, silently falling back to
 * `UTC` for a missing or invalid value — the user never sees a time-zone error
 * during onboarding (see spec: "validate server-side, fallback UTC silently").
 *
 * @param candidate - the browser's `Intl` time-zone name.
 * @returns a valid IANA time-zone name (`UTC` when the candidate is unusable).
 */
export function resolveOnboardingTimezone(candidate: string | null | undefined): string {
  return candidate !== null && candidate !== undefined && isValidTimeZone(candidate) ? candidate : 'UTC';
}

/**
 * The in-app destinations a user can leave onboarding for (allowlisted to
 * prevent open redirects). `/settings/ai?next=diary` carries a query string
 * because connecting a key is not an onboarding step: the last step's key note
 * routes through the `finish` intent (stamping completion) so the user clears
 * the `_personal` onboarding gate before landing on settings, then flows on to
 * the diary once connected (see `settings.ai.tsx`'s `?next=` return).
 */
export const ONBOARDING_EXIT_DESTINATIONS = ['/diary', '/add', '/scan', '/settings/ai?next=diary'] as const;

export type OnboardingExitDestination = (typeof ONBOARDING_EXIT_DESTINATIONS)[number];

/**
 * Narrows a raw exit-destination form value to the allowlist, defaulting to the
 * diary — so a tampered or missing value can never redirect off-app.
 *
 * @param raw - the raw `destination` form value.
 * @returns an allowlisted in-app destination.
 */
export function resolveExitDestination(raw: string | null | undefined): OnboardingExitDestination {
  return ONBOARDING_EXIT_DESTINATIONS.find((destination) => destination === raw) ?? '/diary';
}
