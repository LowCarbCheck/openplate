/**
 * Pure helpers backing the scan confirm-step's preview-first UI (DESIGN.md §3).
 * All functions are side-effect-free so they unit-test without React, a DB, or
 * the network — the confirm form is a thin imperative shell over this core.
 *
 * Two jobs live here:
 *  1. Portion scaling — human "half the plate / as shown / bigger / double"
 *     chips map to multiples of the AI's ORIGINAL grams estimate, and the
 *     selected chip is DERIVED from the current grams (never stored twice).
 *  2. Macro preview — per-portion macro numbers computed from per-100g values,
 *     with the net-carb traffic-light kept on its per-100g basis (see §3).
 *
 * SCOPE NOTE (household portions, M12x): `PORTION_SCALE_OPTIONS`'s "As shown"
 * framing is specific to THIS photo confirm step (scan.tsx) — it refers to
 * the AI's original grams estimate, which genuinely exists there. Non-photo
 * entry points (add.tsx's manual quick-add, diary.entry.$id.tsx's edit form)
 * have no photo to be "as shown" and should use `#app/lib/portions`'s
 * unit-aware `derivePortionChoices` instead — real portion labels like "2
 * eggs", never "As shown" — once that route work lands (see that module's
 * handoff notes). `computeMacroPreview`/`summarizeIncludedPortions`/
 * `roundToTenth` stay shared by both flows: portion LABELING differs, the
 * underlying gram math doesn't.
 */
import type { Macros } from './macros';
import { scaleMacrosPer100gToServing } from './macros';
import { computeNetCarbsFromParts } from './net-carbs';
import type { CarbBasis } from './net-carbs';

/**
 * Rounds grams/macros to one decimal — the confirm form's grams input step.
 * Exported for reuse by `#app/lib/portions` (the unit-aware portion chips),
 * which needs the exact same one-decimal rounding for its own grams math.
 */
export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

////////////////////////////////////////////////////////////////////////////////
// Portion scale chips
////////////////////////////////////////////////////////////////////////////////

/** A human-scale portion chip: a label + a multiplier of the AI's original estimate. */
export interface PortionScaleOption {
  /** Everyday label a struggling user understands, e.g. "As shown". */
  label: string;
  /** Compact multiplier hint shown in parentheses, e.g. "1×". */
  hint: string;
  /** Grams multiplier relative to the AI's original estimate. */
  multiplier: number;
  /** The "as shown" default (1×) — pre-selected before the user touches anything. */
  isDefault: boolean;
}

/** The four portion chips, in display order. Single source of truth for UI + tests. */
export const PORTION_SCALE_OPTIONS: readonly PortionScaleOption[] = [
  { label: 'Smaller', hint: '½×', multiplier: 0.5, isDefault: false },
  { label: 'As shown', hint: '1×', multiplier: 1, isDefault: true },
  { label: 'Bigger', hint: '1.5×', multiplier: 1.5, isDefault: false },
  { label: 'Double', hint: '2×', multiplier: 2, isDefault: false },
];

/** Grams for a chip: the AI's original estimate scaled by the chip's multiplier. */
export function scalePortionGrams(baseGrams: number, multiplier: number): number {
  return roundToTenth(baseGrams * multiplier);
}

/**
 * Derives which chip (if any) the current grams corresponds to, so chip
 * selection is a function of the grams field — never a duplicated piece of
 * state. A manual grams edit that matches no chip returns `null` (all chips
 * deselected).
 *
 * @returns the matching multiplier, or `null` when the grams don't line up with any chip.
 */
export function derivePortionMultiplier({
  baseGrams,
  currentGrams,
}: {
  baseGrams: number;
  currentGrams: number;
}): number | null {
  const target = roundToTenth(currentGrams);
  for (const option of PORTION_SCALE_OPTIONS) {
    if (scalePortionGrams(baseGrams, option.multiplier) === target) return option.multiplier;
  }
  return null;
}

////////////////////////////////////////////////////////////////////////////////
// Macro preview
////////////////////////////////////////////////////////////////////////////////

/** Per-portion macro numbers plus the per-100g net-carb basis used for coloring. */
export interface MacroPreview {
  /** Net carbs per 100 g — the basis for the traffic-light color (DESIGN.md §3). */
  netCarbsPer100g: number;
  /** Net carbs scaled to the current portion — the displayed number. */
  netCarbsForPortion: number;
  /** Protein for the current portion, or `null` when unknown (never fabricated as 0). */
  proteinForPortion: number | null;
  /** Fat for the current portion, or `null` when unknown. */
  fatForPortion: number | null;
  /** Kcal for the current portion, or `null` when unknown. */
  kcalForPortion: number | null;
}

/**
 * Computes the per-portion macro preview from per-100g values. Net carbs come
 * from `computeNetCarbsFromParts` (basis-aware, floored at 0), colored on the
 * per-100g basis — UNLESS `authoritativeNetCarbsPer100g` is supplied, in
 * which case that upstream figure wins outright (see its doc below).
 *
 * @returns the preview, or `null` when net carbs are unknown (the UI then
 *   shows "Macros unknown — logged as name only" instead of numbers).
 */
export function computeMacroPreview({
  macrosPer100g,
  grams,
  authoritativeNetCarbsPer100g,
  carbBasis,
}: {
  macrosPer100g: Macros;
  grams: number;
  /**
   * When supplied — including explicitly `null` — this value is authoritative
   * and used INSTEAD of the local compute-from-parts formula below. LCC's own
   * `FoodMatch.netCarbsPer100g` is origin-aware (bls/curated report
   * fiber-EXCLUSIVE carbs already; fdc/user report fiber-INCLUSIVE "total"
   * carbs) — recomputing the plain formula here for a bls/curated match would
   * double-subtract fiber it was never counting to begin with. Passing that
   * figure through here (e.g. from `LocalQuickAddCandidate.netCarbsPer100g`)
   * is what makes the origin-aware correction actually reach the screen.
   *
   * Omit the argument entirely (`undefined`, the default) for a candidate
   * with no upstream figure of its own — a personal/recent food or an AI
   * plate estimate — which preserves the original self-computed formula.
   *
   * An explicit `null` means the upstream figure ITSELF is unknown for this
   * food (e.g. an fdc-origin match needing fiber to compute "total"-basis net
   * carbs, but fiber wasn't reported) — per the "never fabricate a 0" rule,
   * that resolves the whole preview to `null`, exactly like an unknown
   * `carbs` field does.
   */
  authoritativeNetCarbsPer100g?: number | null;
  /**
   * Which printed-panel convention `macrosPer100g.carbs` was read from,
   * governing the compute-from-parts fallback below when
   * `authoritativeNetCarbsPer100g` is absent — see `#app/lib/net-carbs` and
   * spec 13 (M123). `undefined` (the default) is treated as `total`, today's
   * original formula.
   */
  carbBasis?: CarbBasis;
}): MacroPreview | null {
  const fromParts = computeNetCarbsFromParts(macrosPer100g, carbBasis);
  const netCarbsPer100g =
    authoritativeNetCarbsPer100g !== undefined ? authoritativeNetCarbsPer100g
    : fromParts === null ? null
    : Math.max(0, fromParts);
  if (netCarbsPer100g === null) return null;
  const perPortion = scaleMacrosPer100gToServing(macrosPer100g, grams);
  return {
    netCarbsPer100g,
    netCarbsForPortion: (netCarbsPer100g * grams) / 100,
    proteinForPortion: perPortion.protein,
    fatForPortion: perPortion.fat,
    kcalForPortion: perPortion.kcal,
  };
}

////////////////////////////////////////////////////////////////////////////////
// Plate summary
////////////////////////////////////////////////////////////////////////////////

/** One item's contribution to the plate summary: whether it's included and its per-portion net carbs. */
export interface PlatePortionItem {
  included: boolean;
  netCarbsForPortion: number | null;
}

/** The counts behind the "Adding N foods · ~X g net carbs" line. */
export interface IncludedPortionSummary {
  count: number;
  netCarbs: number;
}

/**
 * Totals the included items for the "Adding N foods · ~X g net carbs" line
 * shown above the confirm button. Excluded items and unknown-carb items
 * contribute 0 net carbs but the latter still count toward `count`.
 */
export function summarizeIncludedPortions(items: readonly PlatePortionItem[]): IncludedPortionSummary {
  let count = 0;
  let netCarbs = 0;
  for (const item of items) {
    if (!item.included) continue;
    count += 1;
    if (item.netCarbsForPortion !== null) netCarbs += item.netCarbsForPortion;
  }
  return { count, netCarbs: roundToTenth(netCarbs) };
}
