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
 * ── One serving is a nominal 100 g ───────────────────────────────────────
 *
 * The store holds a food PER 100 g and a log by weight, and a recipe serving
 * has no weight: nobody knows what a bowl of it weighs, and inventing a figure
 * would put a number in front of the person that looks measured. So a serving
 * is declared to be 100 g of itself: `macrosPer100g` IS the per-serving figure
 * and `quantityGrams` is 100, which makes the stored log's macros exactly the
 * serving the card showed. The `portion` says "1 serving" so the diary renders
 * the unit the person actually chose rather than a bare gram figure, and a
 * later re-portion still rescales correctly, in servings.
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
import type { MealType } from '#types/enums';

/**
 * The weight one serving is declared to be. See the header: it is a unit of
 * account, not a measurement, and it is 100 so the per-100 g food row and the
 * per-serving log row carry the same numbers.
 */
export const RECIPE_SERVING_NOMINAL_GRAMS = 100;

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

/** One serving's macros in the store's own shape. See the header for the carbs reconstruction. */
function servingMacros(recipe: RecipeProposal): Macros {
  return {
    carbs: recipe.perServing.carbsG + recipe.perServing.fiberG,
    fiber: recipe.perServing.fiberG,
    // NEITHER IS KNOWN, and null is the honest answer the whole store rests
    // on: a 0 here would claim the dish contains no sugar and no polyols.
    sugars: null,
    polyols: null,
    protein: recipe.perServing.proteinG,
    fat: recipe.perServing.fatG,
    kcal: recipe.perServing.kcal,
  };
}

/**
 * The food and the log one "Log this" writes, from one proposed recipe.
 *
 * @param options.recipe - the proposal as the card showed it.
 * @param options.slot - the meal slot the person chose at the top of the screen.
 * @param options.dayKey - the device-local calendar day, always today here.
 * @param options.now - epoch-ms, used for all three instants: this is one act.
 * @param options.ids - the minted ids (see {@link RecipeLogIds}).
 * @returns the two rows to persist, in write order.
 */
export function buildRecipeLogEntry({
  recipe,
  slot,
  dayKey,
  now,
  ids,
}: {
  recipe: RecipeProposal;
  slot: MealType;
  dayKey: string;
  now: number;
  ids: RecipeLogIds;
}): RecipeLogEntry {
  const macros = servingMacros(recipe);
  return {
    food: {
      id: ids.foodId,
      name: recipe.title,
      // NO MANUFACTURER. Somebody cooked this; there is nobody to name.
      brand: null,
      macrosPer100g: macros,
      // The same source a photographed plate's food gets: the figures are a
      // model's estimate, not a panel the person read off a package.
      source: 'plate_ai',
      createdAt: now,
    },
    log: {
      id: ids.logId,
      foodId: ids.foodId,
      name: recipe.title,
      quantityGrams: RECIPE_SERVING_NOMINAL_GRAMS,
      // Per-serving, and identical to `macrosPer100g` above by construction,
      // because the serving IS the 100 g. Cloned rather than aliased so the
      // food's macros and the log's never share object identity.
      macros: { ...macros },
      mealType: slot,
      source: 'plate_ai',
      aiEstimated: true,
      curatedSource: null,
      dayKey,
      loggedAt: now,
      createdAt: now,
      logBatchId: ids.logBatchId,
      // "1 serving", so the diary renders the unit the person chose. The
      // grams per unit is the nominal weight above, frozen here exactly as
      // every other portion freezes the figure it was resolved with.
      portion: { unit: 'serving', quantity: 1, gramsPerUnit: RECIPE_SERVING_NOMINAL_GRAMS },
      // No source to credit: nothing here came out of a licensed database.
      attribution: null,
    },
  };
}
