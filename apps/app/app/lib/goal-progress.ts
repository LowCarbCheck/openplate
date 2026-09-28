/**
 * Pure goal-vs-actual arithmetic for the diary's goal-aware day summary. No DB,
 * no React — the loader passes the day's totals and the user's goals, and these
 * compute the bar fill / over-by / met flags the summary renders.
 *
 * Net carbs are a CEILING (staying under is the win; going over is amber, never
 * a destructive-red failure). Protein is a FLOOR (reaching it is the win).
 */

export interface CarbGoalProgress {
  /** The day's net carbs. */
  netCarbs: number;
  /** The user's daily net-carb ceiling. */
  ceiling: number;
  /** Clamped 0..1 fill for the progress bar. */
  fraction: number;
  /** True when net carbs exceed the ceiling. */
  isOver: boolean;
  /** Grams over the ceiling; 0 when at or under it. */
  overByG: number;
}

/** The bar fill fraction, clamped to 0..1. A non-positive ceiling can't be divided against. */
function carbFraction(netCarbs: number, ceiling: number): number {
  if (ceiling <= 0) return netCarbs > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, netCarbs / ceiling));
}

/**
 * Rounds to the nearest whole gram — the same rounding the UI applies before
 * rendering a macro total. The over/under and met/unmet decisions below must
 * use this rounded value, not the raw one: deciding on the raw value while the
 * UI displays the rounded one produces a headline and a state badge that
 * contradict each other (e.g. "20 of 20 g" next to "Over by 0.4 g").
 */
function roundGrams(value: number): number {
  return Math.round(value);
}

/**
 * The single source of truth for "is this day over the carb ceiling?". Every
 * surface that renders an over/under verdict for a day's net carbs — the
 * diary headline (`computeCarbGoalProgress` below), the diary habit-strip dot
 * (`#app/models/habit-strip`), the trends bar chart (`#app/lib/trend-chart`),
 * the weekly recap (`#app/lib/trend-recap`), and the streak card
 * (`#app/lib/local-store/aggregates`) — must call this rather than
 * re-deriving the comparison. Two of those used to compare the RAW values
 * while this one rounded, so the same day could read "met" on one surface and
 * "over" on another for the same number (98.3 g against a 98 g ceiling).
 *
 * Compares whole-gram ROUNDED values, matching the rounding the UI applies
 * before it renders "X of Y g" — so the verdict can never contradict the
 * number the user is shown. Sub-half-gram spillover (98.3 vs a 98 ceiling)
 * rounds both sides to 98 and reads as met, since the headline itself would
 * display "98 of 98 g"; once the raw value rounds past the ceiling (98.6 vs
 * 98 → 99 > 98) it reads as over. At exactly the (rounded) ceiling the day is
 * NOT over — reaching the ceiling is the goal being met, not exceeded.
 *
 * @param netCarbs - the day's net carbs.
 * @param ceiling - the user's daily net-carb ceiling.
 * @returns true when the rounded net carbs exceed the rounded ceiling.
 */
export function isOverCarbGoal({ netCarbs, ceiling }: { netCarbs: number; ceiling: number }): boolean {
  return roundGrams(netCarbs) > roundGrams(ceiling);
}

/**
 * Computes net-carb progress against the daily ceiling. `isOver` is decided by
 * `isOverCarbGoal` (whole-gram rounded, matching what the UI displays) so it
 * can never contradict the displayed "X of Y g" headline.
 *
 * @param netCarbs - the day's net carbs.
 * @param ceiling - the user's daily net-carb ceiling.
 * @returns the bar fraction, over-flag, and grams over.
 */
export function computeCarbGoalProgress({
  netCarbs,
  ceiling,
}: {
  netCarbs: number;
  ceiling: number;
}): CarbGoalProgress {
  const isOver = isOverCarbGoal({ netCarbs, ceiling });
  return {
    netCarbs,
    ceiling,
    fraction: carbFraction(netCarbs, ceiling),
    isOver,
    overByG: isOver ? netCarbs - ceiling : 0,
  };
}

/**
 * The single source of truth for "is this day over the calorie goal?". Same
 * whole-gram-equivalent rounding contract as `isOverCarbGoal`: the verdict is
 * decided on the value the UI displays, so a badge can never contradict the
 * number beside it. At exactly the target the day is NOT over.
 *
 * The calorie goal is a CEILING, not a floor and not a two-sided band — the
 * diary hero already frames it as a budget ("620 left of 1800" / "120 over
 * today"), so that is the framing the user already has.
 *
 * @param kcal - the day's calorie total.
 * @param target - the user's daily calorie target.
 * @returns true when the rounded calories exceed the rounded target.
 */
export function isOverKcalGoal({ kcal, target }: { kcal: number; target: number }): boolean {
  return Math.round(kcal) > Math.round(target);
}

export interface ProteinGoalProgress {
  /** The day's protein total. */
  protein: number;
  /** The user's daily protein floor. */
  floor: number;
  /** True when the day's protein has reached the floor. */
  isMet: boolean;
}

/**
 * Computes protein progress against the daily floor (meeting it is success).
 * `isMet` is decided on the whole-gram rounded values (matching what the UI
 * displays) so it can never contradict the displayed "X / Y g" line — e.g.
 * 99.6 g against a 100 g floor rounds to "100 / 100 g" and must read as met.
 *
 * @param protein - the day's protein total.
 * @param floor - the user's daily protein floor.
 * @returns the totals and whether the floor was met.
 */
export function computeProteinGoalProgress({
  protein,
  floor,
}: {
  protein: number;
  floor: number;
}): ProteinGoalProgress {
  return { protein, floor, isMet: roundGrams(protein) >= roundGrams(floor) };
}
