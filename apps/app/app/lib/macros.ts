/**
 * Shared macro-nutrient shape used across the food tracker (per-100g on
 * `foods`, per-serving snapshots on `food_logs`). Every field but `carbs`
 * is nullable everywhere it's used — an unknown value must stay `null`,
 * never silently become `0` (that would fabricate precision the source
 * data doesn't have).
 */
export interface Macros {
  carbs: number | null;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
  protein: number | null;
  fat: number | null;
  kcal: number | null;
}

/**
 * Scales a per-100g macro set to a specific serving size. Pure function —
 * no I/O, safe to unit test directly. Null fields stay null; they are never
 * defaulted to 0 before scaling.
 */
export function scaleMacrosPer100gToServing(per100g: Macros, grams: number): Macros {
  const scale = (value: number | null): number | null => (value === null ? null : (value * grams) / 100);

  return {
    carbs: scale(per100g.carbs),
    fiber: scale(per100g.fiber),
    sugars: scale(per100g.sugars),
    polyols: scale(per100g.polyols),
    protein: scale(per100g.protein),
    fat: scale(per100g.fat),
    kcal: scale(per100g.kcal),
  };
}
