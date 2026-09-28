/**
 * Pure per-100g recovery for the search-first quick add (/add). No DB, no
 * network, no React — unit-tests directly.
 *
 * Honesty rule (shared with the rest of the tracker): an unknown macro stays
 * `null`, never a fabricated `0`. Recent foods carry a per-SERVING snapshot, so
 * their per-100g basis is recovered by un-scaling the snapshot — see
 * `snapshotToPer100gAtGrams`.
 *
 * `QuickAddCandidate`/`recentFoodToCandidate`/`customFoodToCandidate`/
 * `curatedMatchToCandidate`/`federateQuickAddCandidates` (the server-recent-foods
 * + Drizzle-`SelectFood` federation this module used to also own) were removed
 * in M117/03 deploy-2: candidates are now federated against the local primary
 * store in `app/lib/local-quick-add.ts`, which has its own
 * `localCuratedMatchToCandidate`/`federateLocalQuickAddCandidates`.
 * `QuickAddSource` and `snapshotToPer100gAtGrams` stay here — both are still
 * shared with `local-quick-add.ts` and `search-result-row.tsx`.
 */
import type { Macros } from './macros';

/** Which of the three federated sources a candidate came from — drives its provenance badge. */
export type QuickAddSource = 'recent' | 'custom' | 'curated';

/** All-null macros — used when a per-serving snapshot can't be un-scaled (grams unknown). */
const NULL_MACROS: Macros = {
  carbs: null,
  fiber: null,
  sugars: null,
  polyols: null,
  protein: null,
  fat: null,
  kcal: null,
};

/**
 * Recovers per-100g macros from a per-serving snapshot logged at `grams`. Guards
 * a non-positive `grams` (can't divide) by returning all-null macros so the
 * portion step degrades to "name only" rather than fabricating values.
 *
 * @param snapshot - the per-serving macro snapshot as it was logged.
 * @param grams - the serving size the snapshot was recorded at.
 * @returns the per-100g macro basis (null fields stay null).
 */
export function snapshotToPer100gAtGrams({ snapshot, grams }: { snapshot: Macros; grams: number }): Macros {
  if (grams <= 0) return { ...NULL_MACROS };
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
