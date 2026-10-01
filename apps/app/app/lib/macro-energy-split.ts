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
 * THE SAME THREE SEGMENTS CAN BE READ BY GRAMS. The card carries a kcal/g
 * control (`#app/lib/macro-share-basis`), and on `'grams'` the share is each
 * macro's grams over the three macros' grams, with no Atwater factor: one
 * gram weighs one gram. The maths, the pooling and the `null` rules are the
 * same on both bases.
 *
 * A day that is `hasUnknowns` gives `null`: some macro is missing, so any split
 * drawn from what is known would be a guess dressed as a proportion.
 */
import type { MacroShareBasis } from '#app/lib/macro-share-basis';
import type { DaySummary } from '#app/models/food-log-summary';

/** Atwater energy factor for protein, kcal per gram. */
const KCAL_PER_G_PROTEIN = 4;
/** Atwater energy factor for carbohydrate, kcal per gram. */
const KCAL_PER_G_CARB = 4;
/** Atwater energy factor for fat, kcal per gram. */
const KCAL_PER_G_FAT = 9;

/** Each macro's share of the worked-out energy (or of the grams), in percent. The three sum to 100. */
export interface MacroEnergyShares {
  protein: number;
  carbs: number;
  fat: number;
}

/** Energy per macro in kcal (or grams, on the gram basis) before it is turned into shares. */
interface MacroEnergy {
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * The energy split of one day (or one averaged week).
 *
 * @param summary - the day's macro summary, or `null` for a day with nothing logged.
 * @param basis - `'kcal'` for the energy share (4/4/9, the default), `'grams'` for the gram share.
 * @returns the three shares in percent, or `null` when nothing was logged, the
 *   day has missing macros, or the macros add up to nothing at all.
 */
export function computeMacroEnergySplit(
  summary: DaySummary | null,
  basis: MacroShareBasis = 'kcal',
): MacroEnergyShares | null {
  if (summary === null || summary.hasUnknowns) return null;
  return sharesOf(energyOf(summary, basis));
}

/**
 * The split across a whole range, pooled: the energy of every day that HAS a
 * split is added up first and then divided, so a big day weighs more than a
 * snack day, the way a person's month actually ate. Days with no split
 * (unlogged or partial) are left out, never counted as zero.
 *
 * @param summaries - the range's day summaries, `null` for an unlogged day.
 * @param basis - `'kcal'` for the energy share, `'grams'` for the gram share.
 * @returns the pooled shares, or `null` when no day in the range has a split.
 */
export function computeRangeEnergySplit(
  summaries: readonly (DaySummary | null)[],
  basis: MacroShareBasis = 'kcal',
): MacroEnergyShares | null {
  // A day with no energy adds nothing to the pool, so only the two
  // "no split" cases that carry grams have to be left out by hand.
  const counted = summaries.filter((summary): summary is DaySummary => summary !== null && !summary.hasUnknowns);
  const pooled = counted.map((summary) => energyOf(summary, basis)).reduce(
    (sum, energy) => ({ protein: sum.protein + energy.protein, carbs: sum.carbs + energy.carbs, fat: sum.fat + energy.fat }),
    { protein: 0, carbs: 0, fat: 0 },
  );
  return sharesOf(pooled);
}

/** Grams times the Atwater factors on the kcal basis, plain grams on the gram basis. Negative grams cannot happen upstream, but are clamped so a share can never go negative. */
function energyOf(summary: DaySummary, basis: MacroShareBasis): MacroEnergy {
  const isKcal = basis === 'kcal';
  return {
    protein: Math.max(0, summary.protein) * (isKcal ? KCAL_PER_G_PROTEIN : 1),
    carbs: Math.max(0, summary.carbs) * (isKcal ? KCAL_PER_G_CARB : 1),
    fat: Math.max(0, summary.fat) * (isKcal ? KCAL_PER_G_FAT : 1),
  };
}

/** The amounts turned into percentages of their own total, or `null` for nothing. */
function sharesOf(energy: MacroEnergy): MacroEnergyShares | null {
  const total = energy.protein + energy.carbs + energy.fat;
  if (total <= 0) return null;
  return {
    protein: (energy.protein / total) * 100,
    carbs: (energy.carbs / total) * 100,
    fat: (energy.fat / total) * 100,
  };
}
