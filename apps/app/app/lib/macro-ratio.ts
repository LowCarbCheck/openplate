/**
 * Pure share math for the macro ratio bar (M129/01), no React/DOM, so the
 * zero-guard and rounding behavior are directly unit-testable without
 * rendering `MacroRatioBar`.
 *
 * A share can be read two ways (`MacroShareBasis`): by calories, the default,
 * or by grams. `computeMacroShares` is the one door for both.
 */
import type { MacroShareBasis } from '#app/lib/macro-share-basis';

/** Atwater energy factor for protein, kcal per gram (this file's own copy, as each energy file keeps its own). */
const KCAL_PER_G_PROTEIN = 4;
/** Atwater energy factor for carbohydrate, kcal per gram. */
const KCAL_PER_G_CARB = 4;
/** Atwater energy factor for fat, kcal per gram. */
const KCAL_PER_G_FAT = 9;

/** Per-macro gram totals the ratio bar splits into segment widths. */
export interface MacroRatioGrams {
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
}

/** Each macro's share of the total, as a percentage of the bar's width (0-100, summing to 100). */
export type MacroRatioPercentages = MacroRatioGrams;

/** The calorie shares: three segments, fibre is not an energy source here, and the three sum to 100. */
export interface MacroKcalPercentages {
  carbs: number;
  protein: number;
  fat: number;
}

/**
 * Converts gram totals into segment-width percentages. Returns `null` when
 * every value is non-positive — nothing logged, so there is no ratio to draw
 * (the bar renders a muted empty track for that case instead of dividing by
 * zero).
 *
 * Fibre is counted twice on purpose: it sits inside `carbs` (total carbs) and
 * also has its segment of its own.
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

/**
 * Converts gram totals into each macro's share of the day's energy: protein
 * and carbs at 4 kcal per gram, fat at 9. `carbs` is TOTAL carbs, the same as
 * the "Where your calories come from" card, so the two never disagree about a
 * day. Fibre is not a segment. Returns `null` when the energy is nil, so the
 * bar draws its empty track rather than dividing by zero.
 */
export function computeMacroKcalPercentages(grams: MacroRatioGrams): MacroKcalPercentages | null {
  const carbs = Math.max(0, grams.carbs) * KCAL_PER_G_CARB;
  const protein = Math.max(0, grams.protein) * KCAL_PER_G_PROTEIN;
  const fat = Math.max(0, grams.fat) * KCAL_PER_G_FAT;
  const total = carbs + protein + fat;
  if (total <= 0) return null;
  return { carbs: (carbs / total) * 100, protein: (protein / total) * 100, fat: (fat / total) * 100 };
}

/** The four macros a share can be drawn for, in the order the diary names them. */
export type MacroShareKey = 'carbs' | 'fiber' | 'protein' | 'fat';

/** One drawn segment: which macro, and its width as a percentage of the bar. */
export interface MacroShareSegment {
  key: MacroShareKey;
  percent: number;
}

/**
 * The shares of one basis, as the segments the bar draws left to right. Grams
 * give four (Carbs, Fiber, Protein, Fat), calories give three: there is no
 * `fiber` segment in a calorie share.
 */
export interface MacroShares {
  basis: MacroShareBasis;
  segments: readonly MacroShareSegment[];
}

/**
 * The macro shares of a day (or an averaged week) on the chosen basis.
 *
 * @param grams - the macro grams.
 * @param basis - `'kcal'` for the energy share, `'grams'` for the gram share.
 * @returns the segments tagged with their basis, or `null` when there is nothing to share.
 */
export function computeMacroShares(grams: MacroRatioGrams, basis: MacroShareBasis): MacroShares | null {
  if (basis === 'grams') {
    const p = computeMacroRatioPercentages(grams);
    if (p === null) return null;
    return {
      basis,
      segments: [
        { key: 'carbs', percent: p.carbs },
        { key: 'fiber', percent: p.fiber },
        { key: 'protein', percent: p.protein },
        { key: 'fat', percent: p.fat },
      ],
    };
  }
  const p = computeMacroKcalPercentages(grams);
  if (p === null) return null;
  return {
    basis,
    segments: [
      { key: 'carbs', percent: p.carbs },
      { key: 'protein', percent: p.protein },
      { key: 'fat', percent: p.fat },
    ],
  };
}

/**
 * One macro's percent in `shares`, or `null` when that macro has no segment on
 * this basis (fibre, in a calorie share).
 */
export function percentOfShare({ shares, key }: { shares: MacroShares; key: MacroShareKey }): number | null {
  return shares.segments.find((segment) => segment.key === key)?.percent ?? null;
}
