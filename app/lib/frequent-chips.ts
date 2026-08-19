/**
 * Pure net-carb traffic-light classification for the diary's one-tap
 * "frequent" chips. No DB, no React — unit-tests directly.
 *
 * Honesty rule (shared with the rest of the tracker): an unknown macro stays
 * `null`, never a fabricated `0` — so a food whose carbs are unknown gets no
 * traffic-light dot rather than a green one implying "low carb".
 *
 * `selectFrequentChips`/`FrequentChip` (the server-recent-foods ranking this
 * module used to also own) were removed in M117/03 deploy-2: the frequent-chip
 * source is now the local primary store (`app/lib/local-store/primary-store.ts`),
 * not the dropped `food_logs` table, and `app/lib/local-quick-add.ts` computes
 * its own local-store-backed ranking. This function is the one piece of that
 * logic still shared — it stays here since `local-quick-add.ts` and any future
 * local-store-backed chip ranking both need the same per-100g classification.
 */
import type { Macros } from '#app/lib/macros';
import { getCarbStatus, type CarbStatus } from '#app/utils/carb-status';

/**
 * Net-carb traffic-light status for a per-serving snapshot, recovered to a
 * per-100g basis (DESIGN §3 classifies per 100 g). Returns null when carbs are
 * unknown or the serving size is non-positive — no dot rather than a fabricated
 * one. Unknown fiber/polyols are treated as 0 for the subtraction only (they
 * lower net carbs; their absence is the conservative reading), matching how the
 * day summary rolls net carbs up.
 *
 * @param macros - the per-serving macro snapshot.
 * @param grams - the serving size the snapshot was recorded at.
 * @param options.authoritativeNetCarbsPer100g - see below.
 * @returns the carb-status tier, or null when it can't be classified.
 */
export function chipCarbStatus(
  macros: Macros,
  grams: number,
  {
    authoritativeNetCarbsPer100g,
  }: {
    /**
     * When supplied — including explicitly `null` — this upstream, origin-aware
     * figure decides the tier INSTEAD of the local subtraction below, exactly as
     * it does in `computeMacroPreview` (see that option's doc for the full
     * reasoning). Without it, a chip for a fibre-heavy bls/curated food computes
     * `21.7 − 42.8 = −21.1` and renders a confident GREEN dot for a food whose
     * real figure, 21.7, is red — the same double-subtraction defect the rest of
     * the tracker already fixed, still live on the chip.
     *
     * Omit it entirely (`undefined`, the default) for a food with no upstream
     * figure — a manual entry or an AI plate estimate — which preserves the
     * original self-computed behaviour. An explicit `null` means the upstream
     * figure ITSELF is unknown, which yields no dot rather than a fabricated one.
     */
    authoritativeNetCarbsPer100g?: number | null;
  } = {},
): CarbStatus | null {
  // Checked before the macro/grams guard on purpose: an authoritative figure is
  // already per 100 g, so it needs neither the recorded carbs nor the serving
  // size to classify.
  if (authoritativeNetCarbsPer100g !== undefined) {
    return authoritativeNetCarbsPer100g === null ? null : getCarbStatus(authoritativeNetCarbsPer100g);
  }
  if (macros.carbs === null || grams <= 0) return null;
  const netCarbsPerServing = macros.carbs - (macros.fiber ?? 0) - (macros.polyols ?? 0);
  const netCarbsPer100g = (netCarbsPerServing * 100) / grams;
  return getCarbStatus(netCarbsPer100g);
}
