/**
 * REMOUNT KEYS for the two cards on `/settings/goals` that seed uncontrolled
 * inputs from the loader (M210).
 *
 * Both cards are Conform `useForm` forms: Conform reads `defaultValue` once, at
 * mount, and never again. A save on one card patches the store, redirects and
 * revalidates, so the loader data below it changes, but the inputs keep the
 * numbers they were seeded with. The walk found it on the style card: saving
 * "low calorie" removed the carb ceiling and wrote 1800 kcal, and the goals
 * card underneath went on showing a 50 g daily carb limit until the person
 * navigated away and back.
 *
 * A React `key` built from the loader values a card edits is the fix, and it is
 * the same one `bodyMetricsFormKey` already applies to the body metrics card:
 * the key changes if and only if the stored numbers change, so the form
 * remounts with fresh defaults after a save and NEVER while someone is typing
 * (typing writes nothing to the store).
 */
import type { EatingStyleId } from '#app/lib/eating-style';

/** The four stored numbers the goals card edits. `null` means "not set". */
export interface GoalsCardValues {
  netCarbsCeilingG: number | null;
  proteinFloorG: number | null;
  kcalTarget: number | null;
  targetWeightKg: number | null;
}

/** The style card's remount inputs: the style in effect, and the goals it seeds from. */
export interface EatingStyleCardKeyInput {
  style: EatingStyleId;
  goals: GoalsCardValues;
}

/**
 * A key that changes if and only if one of the four stored goals changes.
 *
 * Every field is part of it on purpose. A key that left the carb ceiling out
 * would be identical before and after the walk's save, since that save only
 * REMOVED the ceiling and left the calorie target where the style put it, and
 * the stale 50 g would survive the fix.
 *
 * @param goals - the stored goals, as the client loader returns them.
 * @returns a string that changes with any one of them.
 */
export function goalsCardKey(goals: GoalsCardValues): string {
  return [goals.netCarbsCeilingG, goals.proteinFloorG, goals.kcalTarget, goals.targetWeightKg]
    .map((value) => (value === null ? '' : String(value)))
    .join('|');
}

/**
 * The same idea for the style card above it, which is stale in the other
 * direction: it preselects the style, the carb preset chip and the calorie
 * field from the numbers, so a save on the goals card has to re-derive all
 * three. The style itself is in the key because a legacy profile's style is
 * DERIVED from those numbers and can change without any of them being the
 * card's own doing.
 *
 * @param input - the style in effect and the stored goals.
 * @returns a string that changes with the style or with any stored goal.
 */
export function eatingStyleCardKey({ style, goals }: EatingStyleCardKeyInput): string {
  return `${style}|${goalsCardKey(goals)}`;
}
