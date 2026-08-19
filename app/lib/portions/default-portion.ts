/**
 * Resolves the "most natural" default portion for a food, so selecting a
 * food never preselects a flat 100 g (the bug this module fixes — see
 * `local-quick-add.ts`'s candidate builders, the callers this was written for).
 */
import { matchHouseholdUnit } from './household-units';
import { portionToGrams, type DisplayPortion } from './types';

/**
 * Grams used when a food has NEITHER an upstream serving size NOR a matched
 * household unit — the same 100 g the app has always defaulted to, now
 * reserved for the genuinely-no-signal case rather than being the universal
 * default. "Where you have no defensible unit, fall back to grams rather
 * than guessing" — this constant IS that fallback.
 */
export const FALLBACK_PORTION_GRAMS = 100;

export interface DefaultPortionInput {
  /** The food's name. Pass the canonical (English) name when available — see `matchHouseholdUnit`'s doc. */
  name: string;
  /** LowCarbCheck's typical single-serving grams for this food (`FoodMatch.portionSize`), or null when unknown. */
  portionSizeGrams: number | null;
}

/**
 * Resolves the "most natural" default portion for a food. Priority:
 *
 * 1. A matched household unit (gives a real label like "egg") — weighted by
 *    the upstream `portionSize` when one is available, since a per-food
 *    measurement beats a generic reference weight for THIS specific food.
 * 2. No named unit, but a known `portionSize` — a plain "1 serving" sized by
 *    that value.
 * 3. Neither — null. The caller falls back to `FALLBACK_PORTION_GRAMS`.
 *
 * Known limitation: household-unit matching is a name-keyword match, not a
 * quantity-aware parse of the food name — a dish name that happens to
 * contain a matched word (e.g. a hypothetical "Egg fried rice") could pick
 * up an inaccurate unit LABEL. The grams stay correct either way (sourced
 * from `portionSizeGrams` or the table's own reference weight) — the worst
 * case is a mislabeled chip, never a math error.
 */
export function resolveDefaultPortion({ name, portionSizeGrams }: DefaultPortionInput): DisplayPortion | null {
  const householdUnit = matchHouseholdUnit(name);
  if (householdUnit) {
    return {
      unit: householdUnit.id,
      quantity: 1,
      gramsPerUnit: portionSizeGrams ?? householdUnit.gramsPerUnit,
    };
  }
  if (portionSizeGrams !== null && portionSizeGrams > 0) {
    return { unit: 'serving', quantity: 1, gramsPerUnit: portionSizeGrams };
  }
  return null;
}

/** The default portion's total grams, falling back to `FALLBACK_PORTION_GRAMS` when no unit can be resolved. */
export function defaultPortionGrams(input: DefaultPortionInput): number {
  const portion = resolveDefaultPortion(input);
  return portion ? portionToGrams(portion) : FALLBACK_PORTION_GRAMS;
}
