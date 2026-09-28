/**
 * One proposed recipe into the two rows the diary stores for it (M233/04).
 *
 * PURE, and the whole write payload: `/pantry/recipes` is then a screen that
 * persists what this returned, which is the same split `/scan`'s
 * `buildConfirmedBatch` exists for. A plate-wide fact that reaches zero rows
 * passes every type check while every screen stays wrong, and the slot is
 * exactly such a fact (it was a hardcoded `mealType: null` on the scan confirm
 * for a whole milestone).
 *
 * ── Why this is not `buildConfirmedBatch` ────────────────────────────────
 *
 * That builder takes a `ConfirmItem`, the parsed shape of `/scan`'s Conform
 * review form, and every field it reads (`estimatedGrams`, a curated match's
 * snapshot, a printed panel's basis) is a fact about a photographed plate. A
 * recipe serving has none of them. What IS copied, deliberately field for
 * field, is what that builder writes: the same `source`, the same
 * `aiEstimated`, the same `curatedSource`, the same three instants, the same
 * shared `logBatchId`.
 *
 * ── A serving has a real weight, and the person says how many ────────────
 *
 * The store holds a food PER 100 g and a log BY WEIGHT, so both numbers need a
 * weight for one serving. It comes from the model, as `servingGrams`, checked
 * against a plausible range in `#app/lib/recipe-serving` before this is ever
 * called. The food's `macrosPer100g` is therefore a real conversion, the log's
 * `quantityGrams` is `servingGrams` times the servings the person said they
 * ate, and the `portion` records exactly that: "1½ servings", each serving
 * frozen at the weight it was proposed with.
 *
 * THIS REPLACES A NOMINAL 100 G (M233/06). A serving used to be DECLARED to
 * weigh 100 g so that `macrosPer100g` could be the per-serving figure
 * unchanged. The operator rejected it on 2026-09-17 for the reason it was
 * always going to be rejected: an entry edited afterwards to its real weight
 * rescales against that fake base, so correcting "1 serving" to "350 g" multiplied
 * every macro by three and a half.
 *
 * ── Net carbs, told the way the store tells them ─────────────────────────
 *
 * The model answers in NET carbs (`perServing.carbsG`), while `Macros.carbs`
 * is the printed-panel TOTAL with an absent `carbBasis` meaning "total". So
 * the total is reconstructed as net plus fibre, and every reader's
 * compute-from-parts fallback (`carbs - fiber - polyols`) lands back on the
 * model's own net figure. Nothing is stored in `netCarbsPer100g`: that field
 * is for a figure an upstream SOURCE committed to, and a plain estimate has
 * none, exactly as a scanned plate has none.
 */
import type { LocalFoodLog, LocalPersonalFood } from '#app/lib/local-store/schema';
import type { Macros } from '#app/lib/macros';
import type { RecipeProposal } from '#app/services/vision/recipe-schema';
import { macrosPer100gFromServing } from '#app/lib/recipe-serving';
import type { MealType } from '#types/enums';

/** The three ids one tap mints, passed in so this stays pure. */
export interface RecipeLogIds {
  /** The personal food the log points at. */
  foodId: string;
  /** The log entry itself. */
  logId: string;
  /** Shared by both rows, so undo acts on the whole tap. */
  logBatchId: string;
}

/** What one tap writes: a food and the log that points at it. */
export interface RecipeLogEntry {
  food: LocalPersonalFood;
  log: LocalFoodLog;
}

/**
 * The macros of what was actually eaten, in the store's own shape.
 *
 * Scaled straight from the model's per-serving figures rather than from the
 * rounded per-100 g row above them, so one whole serving logs exactly the
 * numbers the card showed instead of those numbers put through two roundings.
 * See the header for the carbs reconstruction.
 */
function eatenMacros(recipe: RecipeProposal, servingsEaten: number): Macros {
  return {
    carbs: (recipe.perServing.carbsG + recipe.perServing.fiberG) * servingsEaten,
    fiber: recipe.perServing.fiberG * servingsEaten,
    // NEITHER IS KNOWN, and null is the honest answer the whole store rests
    // on: a 0 here would claim the dish contains no sugar and no polyols.
    sugars: null,
    polyols: null,
    protein: recipe.perServing.proteinG * servingsEaten,
    fat: recipe.perServing.fatG * servingsEaten,
    kcal: recipe.perServing.kcal * servingsEaten,
  };
}

/**
 * The food and the log one "Log this" writes, from one proposed recipe.
 *
 * @param options.recipe - the proposal as the card showed it.
 * @param options.servingsEaten - how many servings the person said they ate, from the card's stepper.
 * @param options.slot - the meal slot the person chose at the top of the screen.
 * @param options.dayKey - the device-local calendar day, always today here.
 * @param options.now - epoch-ms, used for all three instants: this is one act.
 * @param options.ids - the minted ids (see {@link RecipeLogIds}).
 * @returns the two rows to persist, in write order.
 */
export function buildRecipeLogEntry({
  recipe,
  servingsEaten,
  slot,
  dayKey,
  now,
  ids,
}: {
  recipe: RecipeProposal;
  servingsEaten: number;
  slot: MealType;
  dayKey: string;
  now: number;
  ids: RecipeLogIds;
}): RecipeLogEntry {
  const macrosPer100g = macrosPer100gFromServing(recipe.perServing, recipe.servingGrams);
  const eaten = eatenMacros(recipe, servingsEaten);
  return {
    food: {
      id: ids.foodId,
      name: recipe.title,
      // NO MANUFACTURER. Somebody cooked this; there is nobody to name.
      brand: null,
      macrosPer100g,
      // The same source a photographed plate's food gets: the figures are a
      // model's estimate, not a panel the person read off a package.
      source: 'plate_ai',
      createdAt: now,
    },
    log: {
      id: ids.logId,
      foodId: ids.foodId,
      name: recipe.title,
      quantityGrams: recipe.servingGrams * servingsEaten,
      // WHAT WAS EATEN, not what one serving is worth: this is the snapshot
      // every diary reader adds up, so it has to describe `quantityGrams`.
      macros: eaten,
      mealType: slot,
      source: 'plate_ai',
      aiEstimated: true,
      curatedSource: null,
      dayKey,
      loggedAt: now,
      createdAt: now,
      logBatchId: ids.logBatchId,
      // The servings the person chose, so the diary renders "1½ servings"
      // rather than a bare gram figure. The grams per unit is the proposal's
      // own weight, FROZEN here exactly as every other portion freezes the
      // figure it was resolved with: a later re-portion rescales in servings
      // against the weight this recipe was logged with, not against a number
      // some other recipe would have.
      portion: { unit: 'serving', quantity: servingsEaten, gramsPerUnit: recipe.servingGrams },
      // No source to credit: nothing here came out of a licensed database.
      attribution: null,
    },
  };
}
