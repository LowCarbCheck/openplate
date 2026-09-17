/**
 * What one recipe serving WEIGHS, and how many of them a person says they ate
 * (M233/06).
 *
 * PURE: a range, a filter, a step ladder and two conversions. No store, no
 * provider, no React.
 *
 * ── One source of truth, and no second opinion ───────────────────────────
 *
 * The weight comes from the model, as `servingGrams` beside `servings`, and
 * nothing here tries to check it against the recipe's own ingredients. Three
 * reasons, all of them from the counsel of 2026-09-17:
 *
 *  - An ingredient amount may be null ("salt to taste", a tub with no figure
 *    on it), so a sum over the ingredients is biased LOW by construction, and
 *    biased low by an amount nobody can bound.
 *  - A cooked dish weighs less than the raw ingredients that went into it,
 *    because water leaves it. So even a complete sum is the wrong number, and
 *    the correction factor is a property of the cooking, not of the list.
 *  - There is no gram table for "1 piece" of anything a person might own, and
 *    inventing one would put this module in the business of guessing weights,
 *    which is exactly the business the model was asked to be in.
 *
 * ── Out of range means DROPPED, never clamped ────────────────────────────
 *
 * A clamped figure is a figure nobody estimated: 9000 g clamped to 1500 g is
 * still a recipe whose whole serving the model got wrong, now wearing a
 * plausible number. The person would then log a weight that came out of this
 * file. So a recipe outside the range is not shown at all, and a screen with
 * no survivors says it could not build a meal, which is the truth.
 */
import type { Macros } from '#app/lib/macros';
import type { RecipePerServing, RecipeProposal } from '#app/services/vision/recipe-schema';

/** Below this a "serving" is a garnish or a decimal point in the wrong place. */
export const RECIPE_SERVING_MIN_GRAMS = 30;

/** Above this it is the whole pot, or grams confused with something else. */
export const RECIPE_SERVING_MAX_GRAMS = 1500;

/** The half-serving ladder the stepper walks. Half a portion is the smallest real answer. */
export const SERVINGS_STEP = 0.5;

/** Whether one recipe's own serving weight is a figure this app will show. */
function isServableWeight(grams: number): boolean {
  if (!Number.isFinite(grams)) return false;
  return grams >= RECIPE_SERVING_MIN_GRAMS && grams <= RECIPE_SERVING_MAX_GRAMS;
}

/**
 * The proposals whose serving weight is inside the plausible range.
 *
 * @param recipes - every recipe the parse returned, in the order it returned them.
 * @returns the survivors, order preserved. An empty array is a real answer.
 */
export function keepServableRecipes(recipes: readonly RecipeProposal[]): RecipeProposal[] {
  return recipes.filter((recipe) => isServableWeight(recipe.servingGrams));
}

/**
 * The servings a person may say they ate: half a serving up to the whole
 * recipe, in half steps.
 *
 * A one-serving recipe still offers a half, because eating half of a small
 * dish is ordinary. A recipe whose `servings` is not a usable number falls
 * back to the single-serving ladder rather than an empty stepper.
 *
 * @param servings - how many servings the recipe makes.
 * @returns the ladder, ascending, always starting at {@link SERVINGS_STEP}.
 */
export function servingsEatenOptions(servings: number): number[] {
  const top = Number.isFinite(servings) && servings >= 1 ? Math.floor(servings) : 1;
  const steps = Math.round(top / SERVINGS_STEP);
  return Array.from({ length: steps }, (_value, index) => (index + 1) * SERVINGS_STEP);
}

/** One decimal, so a per-100 g figure reads like every other stored macro rather than like a float. */
function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The per-100 g basis the store keeps, from a per-serving figure and the
 * weight of that serving.
 *
 * NET CARBS ARE NOT RECONSTRUCTED HERE. `perServing.carbsG` is net and
 * `Macros.carbs` is the printed-panel total; the caller that writes a log row
 * (`recipe-log.ts`) owns that reconstruction and passes in what it wants
 * scaled, so this function stays one conversion and nothing else.
 *
 * @param perServing - the serving's own figures, as the card showed them.
 * @param servingGrams - what that serving weighs. Must be positive; the filter above guarantees it.
 * @returns the same nutrients per 100 g, each rounded to one decimal.
 */
export function macrosPer100gFromServing(perServing: RecipePerServing, servingGrams: number): Macros {
  const per100g = (value: number): number => oneDecimal((value * 100) / servingGrams);
  return {
    // The printed-panel TOTAL: the model answers in net carbs, so the fibre
    // goes back in and every reader's compute-from-parts fallback lands on the
    // model's own net figure again.
    carbs: per100g(perServing.carbsG + perServing.fiberG),
    fiber: per100g(perServing.fiberG),
    // NEITHER IS KNOWN, and null is the honest answer: a 0 would claim the
    // dish contains no sugar and no polyols.
    sugars: null,
    polyols: null,
    protein: per100g(perServing.proteinG),
    fat: per100g(perServing.fatG),
    kcal: per100g(perServing.kcal),
  };
}

/**
 * The serving weight as a card SHOWS it: to the nearest 10 g.
 *
 * An estimate written as "347 g" claims a precision the model does not have,
 * and a person reading it would reasonably think somebody weighed something.
 *
 * @param grams - the model's own figure.
 * @returns the same weight, rounded to the nearest 10.
 */
export function roundServingGramsForDisplay(grams: number): number {
  return Math.round(grams / 10) * 10;
}
