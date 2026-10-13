/**
 * Pure daily-totals arithmetic for the food log, kept in its own module
 * (no store or React imports) so it's directly unit-testable.
 */
import { computeMacroEnergyTotalKcal } from '#app/lib/macro-energy';
import { computeNetCarbsFromParts, computeTotalCarbsFromParts } from '#app/lib/net-carbs';
import type { CarbBasis } from '#app/lib/net-carbs';

export interface FoodLogMacroSnapshot {
  carbs: number | null;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
  protein: number | null;
  fat: number | null;
  kcal: number | null;
  /**
   * Authoritative net carbs for this entry, already computed upstream (e.g. by
   * an origin-aware LCC API lookup) at log time, when known. Preferred over
   * recomputing from `carbs`/`fiber`/`polyols` — the upstream source can encode
   * rules (origin-specific fiber/polyol treatment) this snapshot's raw parts
   * can't reconstruct. `undefined`/`null` means "no authoritative figure was
   * captured for this entry" and falls back to computing from parts — the path
   * every custom food and AI estimate still takes today.
   */
  netCarbs?: number | null;
  /**
   * Which printed-panel convention `carbs` was read from, governing the
   * compute-from-parts fallback below when `netCarbs` is absent — see
   * `#app/lib/net-carbs` and `LocalFoodLog.carbBasis`'s doc comment for the
   * UNKNOWN-means-`total` rule (spec 13, M123).
   */
  carbBasis?: CarbBasis;
  /** True when these macros were AI-estimated (not manual and not curated). */
  aiEstimated: boolean;
}

export interface DaySummary {
  /**
   * TOTAL carbs in grams, fibre included, whichever panel convention each entry
   * was read from: per entry an `available` (EU) basis adds its fibre back
   * (`carbs + fiber`) and a `total` or unknown basis is taken as printed, and
   * the entries are then summed (`computeTotalCarbsFromParts`). It is NOT the
   * sum of the printed figures, which mixed the two conventions and left the
   * fibre of every EU-panel food out. Every reader treats it as total carbs:
   * the ratio bar's gram basis, the trend chart's total-carbs outline, the
   * weekly recap. `fiber` and `netCarbs` stay as they were.
   */
  carbs: number;
  fiber: number;
  polyols: number;
  netCarbs: number;
  protein: number;
  fat: number;
  kcal: number;
  /**
   * True when the day includes an entry whose net-carbs or calorie figure is
   * genuinely incomplete — `carbs` or `fiber` unknown on an entry with no
   * authoritative `netCarbs` (both feed the app's headline metric), or calories
   * unreported AND not Atwater-derivable. `polyols` being null does NOT trip
   * this on its own: the source data omits it for the overwhelming majority of
   * foods because it legitimately doesn't apply (sugar alcohols are rare), not
   * because it's unknown — flagging on it made this caveat fire on virtually
   * every food while staying silent on entries that were actually missing
   * calories. See `_entryHasUnknowns`.
   */
  hasUnknowns: boolean;
  /**
   * True when any logged entry's macros were AI-estimated. Because summing a
   * bag of estimates doesn't buy sub-gram precision, the UI rounds the totals
   * to whole grams and prefixes them with "~" when this is set.
   */
  hasEstimates: boolean;
}

/**
 * A day with nothing logged: every total at zero and neither caveat raised.
 *
 * Lives here rather than in a route because more than one surface needs "the
 * summary of an empty day" — `/diary` for the day it is showing, `/dashboard`
 * for today — and a second hand-written copy of this literal is how the two
 * screens would eventually disagree about what an empty day looks like.
 */
export const EMPTY_DAY_SUMMARY: DaySummary = {
  carbs: 0,
  fiber: 0,
  polyols: 0,
  netCarbs: 0,
  protein: 0,
  fat: 0,
  kcal: 0,
  hasUnknowns: false,
  hasEstimates: false,
};

/**
 * One entry's net carbs: the upstream authoritative value when present, else
 * `computeNetCarbsFromParts` (basis-aware; see `#app/lib/net-carbs`) — either
 * way clamped at zero. Clamping PER ENTRY (not on the day's summed totals) is
 * load-bearing: a fiber-heavy food's negative net-carbs would otherwise
 * cancel out other foods' carbs when the day's totals are summed first and
 * clamped once at the end.
 */
function _entryNetCarbs(log: FoodLogMacroSnapshot): number {
  if (log.netCarbs !== undefined && log.netCarbs !== null) return Math.max(0, log.netCarbs);
  const fromParts = computeNetCarbsFromParts(log, log.carbBasis);
  return fromParts === null ? 0 : Math.max(0, fromParts);
}

/**
 * One entry's TOTAL carbs, brought onto one basis (see `DaySummary.carbs`).
 * An unknown `carbs` contributes nothing, as it always did in the day's sum.
 */
function _entryTotalCarbs(log: FoodLogMacroSnapshot): number {
  return computeTotalCarbsFromParts(log, log.carbBasis) ?? 0;
}

/**
 * The kcal an entry's macros stand for when it reported none: the same rule
 * the ratio bar and the Insights split use (`computeMacroEnergyKcal`), which is
 * net carbs at 4 kcal per gram, fibre at 2, protein at 4 and fat at 9. Net
 * carbs are the entry's own, basis-aware and clamped at zero (`_entryNetCarbs`),
 * so an EU-panel entry's fibre is no longer counted as carbs at 4.
 *
 * @param log - the entry's macro snapshot.
 * @returns the derived kcal, or `null` when `carbs`, `protein` or `fat` is
 *   unknown: the entry is then uncomputable, never a fabricated 0. An unknown
 *   `fiber` counts as nothing, like in the day's fibre sum.
 */
export function deriveEntryKcal(log: FoodLogMacroSnapshot): number | null {
  if (log.carbs === null || log.protein === null || log.fat === null) return null;
  return computeMacroEnergyTotalKcal({
    netCarbs: _entryNetCarbs(log),
    fiber: log.fiber ?? 0,
    protein: log.protein,
    fat: log.fat,
  });
}

/**
 * One entry's kcal contribution: reported `kcal` wins; otherwise derive it
 * when `deriveEntryKcal` can; otherwise the entry is uncomputable and
 * contributes nothing, never a fabricated 0 masquerading as "this food has no
 * calories".
 */
function _entryKcal(log: FoodLogMacroSnapshot): number {
  if (log.kcal !== null) return log.kcal;
  return deriveEntryKcal(log) ?? 0;
}

/**
 * Whether one entry's contribution to net carbs or calories is genuinely
 * incomplete (see `DaySummary.hasUnknowns` for the "why not polyols" rationale).
 */
function _entryHasUnknowns(log: FoodLogMacroSnapshot): boolean {
  const hasAuthoritativeNetCarbs = log.netCarbs !== undefined && log.netCarbs !== null;
  const netCarbsUnknown = !hasAuthoritativeNetCarbs && (log.carbs === null || log.fiber === null);
  const kcalUnknown = log.kcal === null && (log.carbs === null || log.protein === null || log.fat === null);
  return netCarbsUnknown || kcalUnknown;
}

export function summarizeDay(logs: FoodLogMacroSnapshot[]): DaySummary {
  let carbs = 0;
  let fiber = 0;
  let polyols = 0;
  let netCarbs = 0;
  let protein = 0;
  let fat = 0;
  let kcal = 0;
  let hasUnknowns = false;
  let hasEstimates = false;

  for (const log of logs) {
    if (_entryHasUnknowns(log)) {
      hasUnknowns = true;
    }
    if (log.aiEstimated) {
      hasEstimates = true;
    }
    carbs += _entryTotalCarbs(log);
    fiber += log.fiber ?? 0;
    polyols += log.polyols ?? 0;
    netCarbs += _entryNetCarbs(log);
    protein += log.protein ?? 0;
    fat += log.fat ?? 0;
    kcal += _entryKcal(log);
  }

  return {
    carbs,
    fiber,
    polyols,
    netCarbs,
    protein,
    fat,
    kcal,
    hasUnknowns,
    hasEstimates,
  };
}
