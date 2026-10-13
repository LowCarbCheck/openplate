/**
 * THE ONE RULE for the energy a set of macro grams stands for, on the calorie
 * basis. The diary's ratio bar (`#app/lib/macro-ratio`), the Insights "Where
 * your calories come from" card (`#app/lib/macro-energy-split`) and the kcal
 * fallback of an entry that reported none (`deriveEntryKcal` in
 * `#app/models/food-log-summary`) all call it, so they cannot disagree about
 * the same day.
 *
 * THE FACTORS. Protein 4 kcal per gram and fat 9. Carbohydrate is counted the
 * way EU Regulation 1169/2011 Annex XIV counts it: the carbohydrates that are
 * absorbed at 4 kcal per gram, and fibre at 2. In this app that is NET carbs at
 * 4 and FIBRE at 2. Polyols are not counted, by the operator's decision of
 * 2026-10-13: net carbs already leaves them out, and most of them are near 0 kcal.
 *
 * Counting the carb segment as `4 x total carbs` was wrong twice. It counted
 * fibre at 4, and the total it read was a sum of printed figures that left the
 * fibre of every EU-panel food out (see `computeTotalCarbsFromParts` in
 * `#app/lib/net-carbs`), so a high-fibre low-carb day showed a carb share far
 * below the truth.
 *
 * THREE SEGMENTS STILL. Fibre's energy is part of the carb segment; there is no
 * fourth segment on the calorie basis. The gram basis is unchanged and does not
 * use this file.
 */

/** Energy factor for protein, kcal per gram. */
export const KCAL_PER_G_PROTEIN = 4;
/** Energy factor for net carbohydrate, kcal per gram. */
export const KCAL_PER_G_NET_CARBS = 4;
/** Energy factor for fibre, kcal per gram (EU Regulation 1169/2011, Annex XIV). */
export const KCAL_PER_G_FIBER = 2;
/** Energy factor for fat, kcal per gram. */
export const KCAL_PER_G_FAT = 9;

/** The gram figures the rule reads. Net carbs and fibre are separate on purpose: they carry different factors. */
export interface MacroEnergyGrams {
  netCarbs: number;
  fiber: number;
  protein: number;
  fat: number;
}

/** The energy of each of the three calorie segments, in kcal. The carb segment includes the fibre. */
export interface MacroEnergyKcal {
  carbs: number;
  protein: number;
  fat: number;
}

/**
 * The kcal of each segment. A negative gram figure cannot happen upstream, but
 * is clamped so a segment can never be negative.
 *
 * @param grams - the macro grams of a day, an averaged week or one entry.
 * @returns the kcal of the carb, protein and fat segments.
 */
export function computeMacroEnergyKcal(grams: MacroEnergyGrams): MacroEnergyKcal {
  return {
    carbs: Math.max(0, grams.netCarbs) * KCAL_PER_G_NET_CARBS + Math.max(0, grams.fiber) * KCAL_PER_G_FIBER,
    protein: Math.max(0, grams.protein) * KCAL_PER_G_PROTEIN,
    fat: Math.max(0, grams.fat) * KCAL_PER_G_FAT,
  };
}

/**
 * The three segments added up.
 *
 * @param grams - the macro grams.
 * @returns the total kcal the grams stand for.
 */
export function computeMacroEnergyTotalKcal(grams: MacroEnergyGrams): number {
  const { carbs, protein, fat } = computeMacroEnergyKcal(grams);
  return carbs + protein + fat;
}
