/**
 * Pure daily-totals arithmetic for the food log, kept in its own module
 * (no store or React imports) so it's directly unit-testable.
 */
import { computeNetCarbsFromParts } from '#app/lib/net-carbs';
import type { CarbBasis } from '#app/lib/net-carbs';

/**
 * Atwater energy factors: 4 kcal/g carbohydrate, 4 kcal/g protein, 9 kcal/g fat.
 * Duplicated from `daily-totals.ts`'s `_classifyEntry` (this module can't import
 * it — `daily-totals.ts` imports `summarizeDay` from here, not the other way).
 * Same precedent as the net-carbs formula, which is independently duplicated in
 * `portion-preview.ts`/`frequent-chips.ts`/`export-format.ts`.
 */
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_FAT = 9;

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
 * One entry's kcal contribution: reported `kcal` wins; otherwise Atwater-derive
 * when carbs, protein, and fat are all known (mirrors `daily-totals.ts`'s
 * `_classifyEntry`); otherwise the entry is uncomputable and contributes
 * nothing — never a fabricated 0 masquerading as "this food has no calories".
 */
function _entryKcal(log: FoodLogMacroSnapshot): number {
  if (log.kcal !== null) return log.kcal;
  if (log.carbs !== null && log.protein !== null && log.fat !== null) {
    return KCAL_PER_G_CARB * log.carbs + KCAL_PER_G_PROTEIN * log.protein + KCAL_PER_G_FAT * log.fat;
  }
  return 0;
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
    carbs += log.carbs ?? 0;
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
