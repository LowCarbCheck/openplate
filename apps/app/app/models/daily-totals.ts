/**
 * Pure per-day calorie/estimate computation for the trends view, kept in its
 * own module (no store or React imports) so it's directly unit-testable — same
 * split as `food-log-summary.ts`. This is honesty-first arithmetic: a day's
 * kcal total is only reported when at least one entry is computable, and the
 * `basis`/`derivedShare`/`estimateShare` fields let the UI caveat exactly how
 * trustworthy that number is (all reported vs. Atwater-derived vs. a floor).
 */
import { summarizeDay } from './food-log-summary';
import type { DaySummary, FoodLogMacroSnapshot } from './food-log-summary';

/** Atwater energy factors: 4 kcal/g carbohydrate, 4 kcal/g protein, 9 kcal/g fat. */
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_FAT = 9;

/**
 * How a day's kcal total was arrived at:
 * - `reported`: every computable entry carried its own kcal.
 * - `partly-derived`: every entry is computable, but ≥1 was Atwater-derived.
 * - `incomplete`: a total exists, but ≥1 entry was uncomputable — it's a floor.
 * - `none`: no entry was computable, so there is no total.
 */
export type KcalBasis = 'reported' | 'partly-derived' | 'incomplete' | 'none';

export interface DayKcal {
  /** The day's kcal total, or null when no entry was computable. */
  total: number | null;
  basis: KcalBasis;
  /** Fraction of the computable total that came from Atwater-derived entries; 0 when total is null. */
  derivedShare: number;
}

export interface DailyTotals {
  hasLogs: boolean;
  /** Full macro rollup for the day, or null on an empty day. */
  summary: DaySummary | null;
  kcal: DayKcal;
  /**
   * Fraction of the day attributable to AI-estimated entries — by computable
   * kcal mass when a positive total exists, else by entry count.
   */
  estimateShare: number;
}

/** A single entry's contribution once classified: its kcal, and how it was obtained. */
interface EntryKcal {
  kcal: number;
  isDerived: boolean;
  aiEstimated: boolean;
}

/**
 * Computes the per-day totals for one day's worth of log snapshots.
 *
 * @param logs - the day's per-serving macro snapshots (empty for a gap day).
 * @returns the honesty-annotated daily totals.
 */
export function computeDailyEntry(logs: FoodLogMacroSnapshot[]): DailyTotals {
  const hasLogs = logs.length > 0;
  const summary = hasLogs ? summarizeDay(logs) : null;
  const classified = logs.map(_classifyEntry);
  const computable = classified.filter((entry): entry is EntryKcal => entry !== null);
  const kcal = _computeDayKcal(computable, logs.length - computable.length);
  const estimateShare = _computeEstimateShare({ logs, computable, total: kcal.total });
  return { hasLogs, summary, kcal, estimateShare };
}

/**
 * Classifies one entry's kcal contribution: reported kcal wins; otherwise
 * Atwater-derive only when carbs, protein, and fat are all known; otherwise the
 * entry is uncomputable (null).
 */
function _classifyEntry(log: FoodLogMacroSnapshot): EntryKcal | null {
  if (log.kcal !== null) {
    return { kcal: log.kcal, isDerived: false, aiEstimated: log.aiEstimated };
  }
  if (log.carbs !== null && log.protein !== null && log.fat !== null) {
    const derived = KCAL_PER_G_CARB * log.carbs + KCAL_PER_G_PROTEIN * log.protein + KCAL_PER_G_FAT * log.fat;
    return { kcal: derived, isDerived: true, aiEstimated: log.aiEstimated };
  }
  return null;
}

/** Rolls the classified entries up into the day's `DayKcal`. */
function _computeDayKcal(computable: EntryKcal[], uncomputableCount: number): DayKcal {
  if (computable.length === 0) {
    return { total: null, basis: 'none', derivedShare: 0 };
  }
  const total = computable.reduce((sum, entry) => sum + entry.kcal, 0);
  const derivedMass = computable.reduce((sum, entry) => sum + (entry.isDerived ? entry.kcal : 0), 0);
  const basis = _kcalBasis({ uncomputableCount, derivedMass });
  const derivedShare = total > 0 ? derivedMass / total : 0;
  return { total, basis, derivedShare };
}

/**
 * The `basis` for a day that has ≥1 computable entry: an uncomputable entry
 * makes the total a floor (`incomplete`); otherwise a derived entry softens it
 * to `partly-derived`; otherwise every entry reported its own kcal (`reported`).
 */
function _kcalBasis({ uncomputableCount, derivedMass }: { uncomputableCount: number; derivedMass: number }): KcalBasis {
  if (uncomputableCount > 0) return 'incomplete';
  if (derivedMass > 0) return 'partly-derived';
  return 'reported';
}

/**
 * The AI-estimate share: computable kcal mass from estimated entries over the
 * total when a positive total exists, else the fraction of entries flagged as
 * estimated (so a day with only uncomputable estimates still reads as estimated).
 */
function _computeEstimateShare({
  logs,
  computable,
  total,
}: {
  logs: FoodLogMacroSnapshot[];
  computable: EntryKcal[];
  total: number | null;
}): number {
  if (total !== null && total > 0) {
    const estimatedMass = computable.reduce((sum, entry) => sum + (entry.aiEstimated ? entry.kcal : 0), 0);
    return estimatedMass / total;
  }
  if (logs.length === 0) return 0;
  const estimatedCount = logs.reduce((count, log) => count + (log.aiEstimated ? 1 : 0), 0);
  return estimatedCount / logs.length;
}
