/**
 * Pure percentage math for the diary hero's macro ratio bar (M129/01) — no
 * React/DOM, so the zero-guard and rounding behavior are directly
 * unit-testable without rendering `MacroRatioBar`.
 */

/** Per-macro gram totals the ratio bar splits into segment widths. */
export interface MacroRatioGrams {
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
}

/** Each macro's share of the total, as a percentage of the bar's width (0-100, summing to 100). */
export type MacroRatioPercentages = MacroRatioGrams;

/**
 * Converts gram totals into segment-width percentages. Returns `null` when
 * every value is non-positive — nothing logged, so there is no ratio to draw
 * (the bar renders a muted empty track for that case instead of dividing by
 * zero).
 */
export function computeMacroRatioPercentages(grams: MacroRatioGrams): MacroRatioPercentages | null {
  const total = grams.carbs + grams.protein + grams.fat + grams.fiber;
  if (total <= 0) return null;
  return {
    carbs: (grams.carbs / total) * 100,
    protein: (grams.protein / total) * 100,
    fat: (grams.fat / total) * 100,
    fiber: (grams.fiber / total) * 100,
  };
}
