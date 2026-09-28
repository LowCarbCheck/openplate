/**
 * Household-portion types shared across the tracker: a logged entry should be
 * able to say "2 eggs" and still carry an authoritative gram weight for the
 * macro math — see `#app/lib/local-store/schema`'s `LocalFoodLog.portion`,
 * which persists a `DisplayPortion` alongside the canonical `quantityGrams`
 * so a reload renders "2 eggs" again instead of a bare "116 g".
 *
 * Pure types + arithmetic only — no store, no browser, no server — so this is
 * shared freely by the local-first primary store, the quick-add candidate
 * builders, and (once wired, see the round's handoff notes) the add/diary UI.
 */

/**
 * The small, closed set of portion units the tracker understands today.
 * `'serving'` is the generic fallback used when a food has a known typical
 * serving size (LowCarbCheck's `portionSize`) but no more specific named unit
 * applies — see `household-units.ts` for the named units and their sourcing.
 */
export type PortionUnitId = 'serving' | 'egg' | 'slice' | 'cup' | 'tablespoon' | 'banana' | 'apple';

/**
 * The DISPLAY half of a logged portion — what a person actually chose ("2
 * eggs"), kept alongside the canonical `quantityGrams` on `LocalFoodLog` so
 * a reload renders the real unit again, never a bare gram figure.
 *
 * `gramsPerUnit` is FROZEN at the moment the portion was resolved (from
 * `portionSize`, the built-in household table, or a manual grams entry) — it
 * is never re-derived from the live household-units table on read, so a
 * later correction to that table can never silently rewrite the math behind
 * an already-logged entry.
 */
export interface DisplayPortion {
  unit: PortionUnitId;
  /** How many of `unit`, e.g. 2 for "2 eggs". Always > 0. */
  quantity: number;
  /** Grams represented by ONE `unit`, as resolved when this portion was chosen. */
  gramsPerUnit: number;
}

/** The total grams a display portion represents (`quantity * gramsPerUnit`). Pure. */
export function portionToGrams(portion: DisplayPortion): number {
  return portion.quantity * portion.gramsPerUnit;
}
