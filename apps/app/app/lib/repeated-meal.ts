/**
 * "You have eaten this three days running" (M227/03).
 *
 * ── Why it exists ────────────────────────────────────────────────────────
 *
 * Two people in five days failed to find "save as meal", which has shipped on
 * the diary's meal header since M123/07. A door nobody opens is worth no more
 * than a door that was never built, so the diary now says something first, on
 * the one occasion where saving a meal is obviously worth it: the person has
 * just logged the same breakfast for the third day in a row.
 *
 * ── Pure, and it decides nothing about the UI ────────────────────────────
 *
 * Entries in, slots out. No clock (the viewed day is a parameter), no store,
 * no translator, and no opinion about whether a hint was dismissed, which is
 * the caller's business. That split is what lets the run length and the
 * comparison be tested without a browser.
 *
 * ── What "identical" means ───────────────────────────────────────────────
 *
 * Same set of food names, each at the same grams. Nothing else: not the time
 * of day, not the macros, not the order they were logged in, and not the
 * source (a food typed by hand and the same food copied from yesterday are
 * the same meal to the person eating it). One gram of difference is a
 * different meal, and `tests/unit/repeated-meal.test.ts` holds that control.
 *
 * ── The "no meal" bucket is never a run ──────────────────────────────────
 *
 * An entry with no slot is an entry the person declined to file. Three
 * unfiled days are not a routine, they are three days of not answering the
 * question, and a saved meal built from them would be named after nothing.
 */
import type { MealType } from '#types/enums';
import { MEAL_TYPES } from '#app/lib/meal-choice';
import { shiftDate } from '#app/lib/user-days';

/**
 * How many consecutive days, including the viewed one, make a routine.
 *
 * Three, because two is a coincidence: somebody who ate the same lunch
 * yesterday and today may simply have leftovers. The third day is the first
 * one that says "this is what I eat".
 */
export const REPEAT_RUN_DAYS = 3;

/** One logged entry, as the comparison below reads it. */
export interface RepeatedMealEntry {
  /** The local `YYYY-MM-DD` day the entry was filed under. */
  dayKey: string;
  /** The slot it was filed into, or null for the "no meal" bucket. */
  mealType: MealType | null;
  /** The food's name, compared case-insensitively. */
  name: string;
  /** The portion, compared to one decimal place. */
  quantityGrams: number;
}

/** Grams are compared at this precision, so 100 and 100.04 are one portion. */
const GRAMS_PRECISION = 10;

/**
 * A stable string for one slot's entries on one day, `''` for an empty slot.
 *
 * Sorted, so "porridge then coffee" and "coffee then porridge" are the same
 * breakfast. Lower-cased and trimmed by the same rule the diary's favorites
 * use, so a re-typed name with a stray capital is still the same food.
 *
 * @param entries - the entries filed into one slot on one day.
 * @returns the fingerprint to compare against another day's.
 */
export function mealGroupFingerprint(entries: readonly RepeatedMealEntry[]): string {
  return entries
    .map((entry) => `${entry.name.trim().toLowerCase()}@${Math.round(entry.quantityGrams * GRAMS_PRECISION)}`)
    .toSorted()
    .join('|');
}

/**
 * Which of the viewed day's meal slots repeat the two days before it.
 *
 * @param logs - every entry on the device; days outside the run are ignored.
 * @param date - the viewed day, as `YYYY-MM-DD`.
 * @returns the slots whose group is identical on all {@link REPEAT_RUN_DAYS} days.
 */
export function selectRepeatedMealSlots({
  logs,
  date,
}: {
  logs: readonly RepeatedMealEntry[];
  date: string;
}): MealType[] {
  const days = Array.from({ length: REPEAT_RUN_DAYS }, (unused, index) => shiftDate(date, -index));
  return MEAL_TYPES.filter((slot) => {
    const fingerprints = days.map((day) =>
      mealGroupFingerprint(logs.filter((log) => log.dayKey === day && log.mealType === slot)),
    );
    // An empty slot fingerprints as `''`, so this one guard also rules out a
    // day the person logged nothing into: three empty breakfasts are equal to
    // each other, and they are not a routine.
    const [first] = fingerprints;
    if (first === undefined || first === '') return false;
    return fingerprints.every((fingerprint) => fingerprint === first);
  });
}
