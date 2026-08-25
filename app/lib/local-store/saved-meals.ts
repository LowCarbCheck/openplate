/**
 * Pure builders for saved meals (M123/07 item 1) — no store, no browser, no
 * clock/id generation of its own. `save-as-meal` bundles a set of currently-
 * logged foods (typically a meal group) into a named, reusable `LocalSavedMeal`;
 * re-logging one creates a fresh `LocalFoodLog` per item, stamped with
 * whatever day/time/meal the re-log names. Every impure input (ids, "now") is
 * passed in by the caller, mirroring the split `copy-day.ts` and
 * `diary.tsx`'s `buildRestoredEntry`/`buildCopiedEntry` already established —
 * so the whole "logs in → saved meal → logs out" round trip is directly
 * unit-testable.
 */
import type { LocalFoodLog, LocalSavedMeal, LocalSavedMealItem } from './schema';

/**
 * Snapshots one log entry into a saved-meal item — every field a re-log needs
 * to recreate it, minus placement (`dayKey`/`loggedAt`/`mealType`/
 * `logBatchId`), which a saved meal deliberately does not carry: it is a
 * template, not a pinned-to-a-day log.
 */
function toSavedMealItem(log: LocalFoodLog): LocalSavedMealItem {
  return {
    name: log.name,
    quantityGrams: log.quantityGrams,
    macros: log.macros,
    source: log.source,
    aiEstimated: log.aiEstimated,
    curatedSource: log.curatedSource,
    foodId: log.foodId,
    portion: log.portion,
    attribution: log.attribution,
    netCarbsPer100g: log.netCarbsPer100g,
    carbBasis: log.carbBasis,
    micronutrientsPer100g: log.micronutrientsPer100g,
  };
}

/**
 * Builds a saved meal from a set of currently-logged entries (the "save as
 * meal" action). `logs` may be empty at the type level, but the caller (the
 * route action) is expected to reject an empty selection before this runs —
 * a nameable bundle of zero foods is not a meal.
 *
 * @param options.logs - the entries to bundle, any order (item order is preserved).
 * @param options.name - the person's chosen name for the meal.
 * @param options.id - the fresh local id for the new saved-meal row.
 * @param options.createdAtMs - the instant this meal was saved, epoch ms.
 * @returns the saved meal to persist.
 */
export function buildSavedMealFromLogs({
  logs,
  name,
  id,
  createdAtMs,
}: {
  logs: readonly LocalFoodLog[];
  name: string;
  id: string;
  createdAtMs: number;
}): LocalSavedMeal {
  return { id, name, items: logs.map(toSavedMealItem), createdAt: createdAtMs };
}

/**
 * Builds the fresh `LocalFoodLog` entries a "re-log this saved meal" action
 * persists — one per item, every one sharing the SAME placement (day/time/
 * meal) and the SAME `logBatchId`, so the re-log groups and undoes as one
 * unit exactly like a copy-yesterday batch does (`diary.tsx`'s
 * `buildCopiedEntry`/`handleCopyYesterday`).
 *
 * @param options.meal - the saved meal to re-log.
 * @param options.makeId - called once per item to mint that entry's fresh local id.
 * @param options.dayKey - the device-local calendar day the re-log lands on.
 * @param options.loggedAtMs - the instant every re-logged item is stamped with.
 * @param options.mealType - the meal slot every re-logged item is stamped with.
 * @param options.logBatchId - the shared batch id grouping this re-log for one-tap undo.
 * @param options.createdAtMs - the instant these rows are created on-device.
 * @returns one fresh entry per saved-meal item, in the meal's own item order.
 */
export function buildLogsFromSavedMeal({
  meal,
  makeId,
  dayKey,
  loggedAtMs,
  mealType,
  logBatchId,
  createdAtMs,
}: {
  meal: LocalSavedMeal;
  makeId: () => string;
  dayKey: string;
  loggedAtMs: number;
  mealType: LocalFoodLog['mealType'];
  logBatchId: string;
  createdAtMs: number;
}): LocalFoodLog[] {
  return meal.items.map((item) => ({
    id: makeId(),
    name: item.name,
    quantityGrams: item.quantityGrams,
    macros: item.macros,
    mealType,
    source: item.source,
    aiEstimated: item.aiEstimated,
    curatedSource: item.curatedSource,
    foodId: item.foodId,
    dayKey,
    loggedAt: loggedAtMs,
    createdAt: createdAtMs,
    logBatchId,
    portion: item.portion,
    attribution: item.attribution,
    netCarbsPer100g: item.netCarbsPer100g,
    carbBasis: item.carbBasis,
    micronutrientsPer100g: item.micronutrientsPer100g,
  }));
}
