/**
 * Where a day's calories come from (M239/03): the share of energy from
 * protein, carbs and fat, worked out from grams with the Atwater factors
 * 4 / 4 / 9. Pure: a day summary in, three percentages out.
 *
 * THIS IS NOT `kcal.total`. A reported calorie figure on a label can differ
 * from 4/4/9 times its macros (rounding, fiber counted at 2 kcal, alcohol), so
 * the card that draws these shares says it is worked out from the macros.
 *
 * CARBS MEANS TOTAL CARBS (`DaySummary.carbs`), not net carbs. That is how the
 * app already counts energy from carbs wherever it derives calories:
 * `_classifyEntry` in `app/models/daily-totals.ts` and `_entryKcal` in
 * `app/models/food-log-summary.ts` both multiply the entry's `carbs` by 4.
 * Using net carbs here would make this split disagree with the app's own
 * derived calorie totals.
 *
 * A day that is `hasUnknowns` gives `null`: some macro is missing, so any split
 * drawn from what is known would be a guess dressed as a proportion.
 */
import type { DaySummary } from '#app/models/food-log-summary';

/** Atwater energy factor for protein, kcal per gram. */
const KCAL_PER_G_PROTEIN = 4;
/** Atwater energy factor for carbohydrate, kcal per gram. */
const KCAL_PER_G_CARB = 4;
/** Atwater energy factor for fat, kcal per gram. */
const KCAL_PER_G_FAT = 9;

/** Each macro's share of the worked-out energy, in percent. The three sum to 100. */
export interface MacroEnergyShares {
  protein: number;
  carbs: number;
  fat: number;
}

/** Energy per macro, in kcal, before it is turned into shares. */
interface MacroEnergy {
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * The energy split of one day (or one averaged week).
 *
 * @param summary - the day's macro summary, or `null` for a day with nothing logged.
 * @returns the three shares in percent, or `null` when nothing was logged, the
 *   day has missing macros, or the macros add up to no energy at all.
 */
export function computeMacroEnergySplit(summary: DaySummary | null): MacroEnergyShares | null {
  if (summary === null || summary.hasUnknowns) return null;
  return sharesOf(energyOf(summary));
}

/**
 * The split across a whole range, pooled: the energy of every day that HAS a
 * split is added up first and then divided, so a big day weighs more than a
 * snack day, the way a person's month actually ate. Days with no split
 * (unlogged or partial) are left out, never counted as zero.
 *
 * @param summaries - the range's day summaries, `null` for an unlogged day.
 * @returns the pooled shares, or `null` when no day in the range has a split.
 */
export function computeRangeEnergySplit(summaries: readonly (DaySummary | null)[]): MacroEnergyShares | null {
  // A day with no energy adds nothing to the pool, so only the two
  // "no split" cases that carry grams have to be left out by hand.
  const counted = summaries.filter((summary): summary is DaySummary => summary !== null && !summary.hasUnknowns);
  const pooled = counted.map(energyOf).reduce(
    (sum, energy) => ({ protein: sum.protein + energy.protein, carbs: sum.carbs + energy.carbs, fat: sum.fat + energy.fat }),
    { protein: 0, carbs: 0, fat: 0 },
  );
  return sharesOf(pooled);
}

/** Grams times the Atwater factors. Negative grams cannot happen upstream, but are clamped so a share can never go negative. */
function energyOf(summary: DaySummary): MacroEnergy {
  return {
    protein: Math.max(0, summary.protein) * KCAL_PER_G_PROTEIN,
    carbs: Math.max(0, summary.carbs) * KCAL_PER_G_CARB,
    fat: Math.max(0, summary.fat) * KCAL_PER_G_FAT,
  };
}

/** Energy turned into percentages of its own total, or `null` for no energy. */
function sharesOf(energy: MacroEnergy): MacroEnergyShares | null {
  const total = energy.protein + energy.carbs + energy.fat;
  if (total <= 0) return null;
  return {
    protein: (energy.protein / total) * 100,
    carbs: (energy.carbs / total) * 100,
    fat: (energy.fat / total) * 100,
  };
}
