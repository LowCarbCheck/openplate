/**
 * The signature "traffic-light" carb-status classification (see DESIGN.md §3).
 * Net carbs per 100 g map to three tiers — this is the ONLY place the
 * thresholds and the per-tier Tailwind class recipes may live. Anything that
 * renders per-100g food data (curated match cards, per-food draft cards,
 * food-log entries) imports from here rather than re-inlining colors.
 */

/** Low = ≤ 5 g net carbs / 100 g. */
const LOW_CARB_MAX_PER_100G = 5;
/** Moderate = ≤ 10 g net carbs / 100 g; anything above is `high`. */
const MODERATE_CARB_MAX_PER_100G = 10;

export type CarbStatus = 'low' | 'moderate' | 'high';

/**
 * Classifies a net-carbs-per-100g value into the traffic-light tier.
 *
 * @param netCarbsPer100g Net carbohydrates per 100 g of food.
 * @returns The carb-status tier for coloring/labelling.
 */
export function getCarbStatus(netCarbsPer100g: number): CarbStatus {
  if (netCarbsPer100g <= LOW_CARB_MAX_PER_100G) return 'low';
  if (netCarbsPer100g <= MODERATE_CARB_MAX_PER_100G) return 'moderate';
  return 'high';
}

/** Badge / tile fill classes (both light and dark palettes) per DESIGN.md §3. */
export const carbStatusBadgeClass = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  moderate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
} satisfies Record<CarbStatus, string>;

/** Standalone text-color classes per DESIGN.md §3. */
export const carbStatusTextClass = {
  low: 'text-green-700 dark:text-green-400',
  moderate: 'text-yellow-700 dark:text-yellow-400',
  high: 'text-red-700 dark:text-red-400',
} satisfies Record<CarbStatus, string>;

/** Status-dot indicator classes per DESIGN.md §3. */
export const carbStatusDotClass = {
  low: 'bg-green-500',
  moderate: 'bg-yellow-400',
  high: 'bg-red-500',
} satisfies Record<CarbStatus, string>;
