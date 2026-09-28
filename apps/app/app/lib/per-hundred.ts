/**
 * Reconstructs a per-100g macro basis from a food-log's per-serving snapshot.
 * Pure — no I/O, directly unit-testable. Backs the diary entry receipt (the
 * hero net-carb tile) and the portion-first edit form, both of which need a
 * per-100g basis to color the carb traffic-light (DESIGN.md §3) and to rescale
 * macros when the portion changes.
 *
 * The linked master `foods` row is the authoritative per-100g source when an
 * entry still carries curated/AI provenance; only when there is no such row
 * does the caller fall back to this reconstruction (snapshot ÷ grams × 100).
 */
import type { Macros } from './macros';

/**
 * Rebuilds per-100g macros from a per-serving snapshot: each value × 100 ÷ grams.
 * Null snapshot fields stay null (an unknown macro is never fabricated as 0).
 *
 * @param snapshot - the per-serving macro snapshot stored on the log row.
 * @param grams - the serving size the snapshot was taken at.
 * @returns the per-100g basis, or `null` when `grams` is not a positive finite
 *   number (division is undefined, so there is no honest basis to show).
 */
export function reconstructPer100g(snapshot: Macros, grams: number): Macros | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const per100 = (value: number | null): number | null => (value === null ? null : (value * 100) / grams);
  return {
    carbs: per100(snapshot.carbs),
    fiber: per100(snapshot.fiber),
    sugars: per100(snapshot.sugars),
    polyols: per100(snapshot.polyols),
    protein: per100(snapshot.protein),
    fat: per100(snapshot.fat),
    kcal: per100(snapshot.kcal),
  };
}
