/**
 * Where a day's calories come from (M239/03): the share of energy from
 * protein, carbs and fat, worked out from grams by the app's one energy rule
 * (`computeMacroEnergyKcal` in `#app/lib/macro-energy`): net carbs and protein
 * at 4 kcal per gram, fibre at 2, fat at 9. Pure: a day summary in, three
 * percentages out. The diary's ratio bar reads the same rule, so the two agree
 * about a day.
 *
 * THIS IS NOT `kcal.total`. A reported calorie figure on a label can differ
 * from the sum of these factors (rounding, polyols, alcohol), so the card that
 * draws these shares says it is worked out from the macros.
 *
 * THE CARB SEGMENT IS NET CARBS AT 4 PLUS FIBRE AT 2. It used to be total carbs
 * at 4, and `DaySummary.carbs` used to be a sum of printed figures that left
 * the fibre of every EU-panel food out, so a high-fibre day read far too low
 * on carbs. Polyols are not counted.
 *
 * THE SAME THREE SEGMENTS CAN BE READ BY GRAMS. The card carries a kcal/g
 * control (`#app/lib/macro-share-basis`), and on `'grams'` the share is each
 * macro's grams over the three macros' grams, with no energy factor: one
 * gram weighs one gram. The carb grams are TOTAL carbs (`DaySummary.carbs`).
 * The pooling and the `null` rules are the same on both bases.
 *
 * A day that is `hasUnknowns` gives `null`: some macro is missing, so any split
 * drawn from what is known would be a guess dressed as a proportion.
 */
import { computeMacroEnergyKcal } from '#app/lib/macro-energy';
import type { MacroShareBasis } from '#app/lib/macro-share-basis';
import type { DaySummary } from '#app/models/food-log-summary';

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
 * @param basis - `'kcal'` for the energy share (`#app/lib/macro-energy`, the default), `'grams'` for the gram share.
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

/** The energy rule on the kcal basis, plain total-carb, protein and fat grams on the gram basis. */
function energyOf(summary: DaySummary, basis: MacroShareBasis): MacroEnergy {
  if (basis === 'kcal') return computeMacroEnergyKcal(summary);
  return {
    protein: Math.max(0, summary.protein),
    carbs: Math.max(0, summary.carbs),
    fat: Math.max(0, summary.fat),
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
