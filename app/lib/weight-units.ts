/**
 * Pure kg <-> lb conversion for body-weight display. Every weight is stored
 * and validated in kilograms end to end (`weight_kg numeric(5,2)`,
 * `#app/lib/onboarding`'s `parseWeightKg`, `settings.goals.tsx`'s
 * `LogWeightSchema`) — this module only converts what a person TYPES/SEES in
 * their preferred unit into the kg number the rest of the app already
 * expects, and back again for display. No DB, no React, so it's directly
 * unit-testable and shared by any screen that lets someone enter a weight
 * (onboarding's weight step today; settings/goals can reuse the same
 * conversion math for its own kg-only fields).
 */

export const WEIGHT_UNITS = ['kg', 'lb'] as const;

export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** Exact kilograms per international pound. */
const KG_PER_LB = 0.45359237;

/**
 * Converts a weight from `unit` into kilograms.
 *
 * @param value - the weight, in `unit`.
 * @param unit - the unit `value` is expressed in.
 * @returns the equivalent weight in kilograms.
 */
export function toKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

/**
 * Converts a weight in kilograms into `unit`.
 *
 * @param kg - the weight, in kilograms.
 * @param unit - the unit to convert into.
 * @returns the equivalent weight in `unit`.
 */
export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

/**
 * Rounds a weight for on-screen display — 1 decimal place, which reads
 * naturally in both kg and lb without implying more precision than a home
 * scale actually gives you.
 *
 * @param value - a weight in any unit.
 * @returns `value` rounded to 1 decimal place.
 */
export function roundWeightForDisplay(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Formats a stored kg value for display in `unit`, or `''` for `null` (no
 * value yet) — never fabricates a `0`.
 *
 * @param kg - the stored weight in kilograms, or `null` when unset.
 * @param unit - the unit to display it in.
 * @returns a display string, or `''` when `kg` is `null`.
 */
export function formatKgForDisplay(kg: number | null, unit: WeightUnit): string {
  if (kg === null) return '';
  return String(roundWeightForDisplay(fromKg(kg, unit)));
}

/**
 * Reads a typed number that may use a decimal COMMA, which is what most of
 * Europe types (`72,5`) and what a German keyboard offers first. Bare
 * `Number()` reads that as `NaN`, so a German-locale weigh-in used to
 * disappear silently — see `toWeightSubmitValue` for the other half of that
 * fix.
 *
 * Only the unambiguous case is accepted: exactly one comma and no dot. A
 * thousands separator (`1,234`), a mixed `1.234,5`, or a doubled `7,,5` is
 * still rejected rather than guessed at — a weight silently multiplied by a
 * thousand is worse than a rejected one.
 *
 * @param trimmed - an already-trimmed input string.
 * @returns the number it denotes, or `NaN` when it denotes none.
 */
function readDecimalNumber(trimmed: string): number {
  if (!trimmed.includes(',')) return Number(trimmed);
  if (trimmed.includes('.')) return Number.NaN;
  if (trimmed.indexOf(',') !== trimmed.lastIndexOf(',')) return Number.NaN;
  return Number(trimmed.replace(',', '.'));
}

/**
 * Parses a raw display string (in `unit`) into kilograms, rounded for
 * storage. A decimal comma is accepted (see `readDecimalNumber`). Blank,
 * non-numeric, or non-positive input resolves to `null` — the caller decides
 * how to handle an out-of-range result the same way it already does for a
 * plain kg input.
 *
 * @param raw - the raw input string, in `unit`.
 * @param unit - the unit `raw` is expressed in.
 * @returns the equivalent weight in kilograms (2-decimal precision), or `null`.
 */
export function parseDisplayWeightToKg(raw: string, unit: WeightUnit): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = readDecimalNumber(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(toKg(value, unit) * 100) / 100;
}

/**
 * The value a hidden kg field should submit for what the user typed into the
 * visible (unit-aware) input.
 *
 * Blank stays blank — every weight field in the app treats that as "skip" or
 * "clear", and that is deliberate. But a field the user DID fill in and that
 * doesn't read as a weight must not submit blank either: that made a typo
 * indistinguishable from an empty field, so the entry was dropped (or an
 * existing goal cleared) with nothing on screen to say so. Passing the raw
 * text through instead lets the receiving validator fail it and show the
 * person their mistake.
 *
 * @param raw - the raw text in the visible input, in `unit`.
 * @param unit - the unit `raw` is expressed in.
 * @returns kilograms as a string, the trimmed raw text, or `''` when blank.
 */
export function toWeightSubmitValue(raw: string, unit: WeightUnit): string {
  const kg = parseDisplayWeightToKg(raw, unit);
  if (kg !== null) return String(kg);
  return raw.trim();
}
