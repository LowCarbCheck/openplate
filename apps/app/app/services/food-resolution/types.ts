/**
 * App-owned types for the LowCarbCheck food-resolution integration. These are
 * deliberately NOT the raw LCC API response shape — the wire response is
 * validated and mapped into these owned types in `./schema`, so a change to
 * the external contract is contained to one adapter (see the "wrap third-party"
 * rule). Every macro field is `number | null`: LCC returns null when a value
 * is genuinely unknown, and that null is preserved end-to-end rather than
 * being fabricated as 0.
 */

import type { MicronutrientsPer100g } from '#app/lib/micronutrients';

export interface FoodMatchMacros {
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
}

export interface FoodMatch {
  /** Locale-specific food slug on lowcarbcheck.org — used to build provenance (`lowcarbcheck:<slug>`). */
  slug: string;
  locale: string;
  /** Localized display title (e.g. "Chicken breast"). */
  title: string;
  /** Canonical (English) name of the underlying food. */
  canonicalName: string;
  /**
   * Public food page on lowcarbcheck.org — surfaced as an outbound link. Null
   * for imported foods (e.g. BLS-origin) that have no public page, in which case
   * no link is rendered.
   */
  url: string | null;
  /** Real image URL, or null when the food has no curated image (no placeholder is fabricated). */
  imageUrl: string | null;
  macrosPer100g: FoodMatchMacros;
  /**
   * LCC's own net-carbs figure — already normalized for the source's carb
   * convention (e.g. BLS reports fiber-exclusive "available" carbs, FDC
   * reports fiber-inclusive "total" carbs; a naive `carbs - fiber` recompute
   * on this end would silently double-subtract or under-subtract depending
   * on origin). Treat this as the authoritative value; do not recompute it
   * from `macrosPer100g` downstream. Null when a required input for that
   * origin's convention is unknown.
   */
  netCarbsPer100g: number | null;
  /**
   * Source/licence credit shown at the point of display to satisfy the source's
   * attribution terms (e.g. "Bundeslebensmittelschlüssel (BLS) 4.0 — Max
   * Rubner-Institut, CC BY 4.0 (adapted)"). Null for curated foods.
   */
  attribution: string | null;
  /** Relevance score in the range 0..1 (higher is a better match). */
  score: number;
  /**
   * Data provenance (mirrors LCC's `content_foods.origin`: `"curated"`,
   * `"bls"`, `"user"`, or `"fdc"`). Kept as a plain string rather than a
   * closed union — this is an external field and LCC may add an origin value
   * openplate hasn't seen yet; treat unrecognized values as "just informational
   * context", never as a validation failure. Null on the pre-rollout API shape
   * that predates this field.
   */
  origin: string | null;
  /**
   * Typical single-serving portion size in grams, or null when the source row
   * has no value (curated foods only today — see LCC's `content_foods.portion_size`)
   * or on the pre-rollout API shape that predates this field.
   */
  portionSize: number | null;
  /**
   * The food's per-100 g vitamins and minerals (M135), on the same basis as
   * `macrosPer100g`. OPTIONAL, and its absence is load-bearing rather than
   * incidental: LCC omits the blocks entirely for origins that have no
   * micronutrient dimension (BLS, FDC), which is a DIFFERENT fact from a block
   * whose figures are all `null` ("we have the dimension, this food's figures
   * are unknown"). `toFoodMatch` never normalizes one into the other — see
   * `#app/lib/micronutrients`, which owns the three-state contract and the
   * only sanctioned reader for it.
   *
   * Never defaulted, never zero-filled: a missing micronutrient must reach the
   * daily aggregation AS missing so it can be counted against coverage instead
   * of silently summed as 0.
   */
  micronutrientsPer100g?: MicronutrientsPer100g;
}
