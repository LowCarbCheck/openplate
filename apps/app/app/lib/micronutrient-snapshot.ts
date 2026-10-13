/**
 * The vitamins and minerals of one window, reduced to what an overview pane can
 * say about them in a few lines: how many nutrients the log covers, the gaps,
 * and the limits it went over. The pure half; `/nutrients` is the full list.
 *
 * It reads the rows `buildNutrientRows` already built, and every rule it
 * applies is that module's: the coverage bar is the aggregation's, a gap is
 * `pickLightestNutrients`, a limit is `isAboveReferenceLimit`. Nothing here
 * re-decides any of them, so the pane and the deep dive cannot disagree.
 *
 * ── THE SAME TWO RULES AS `/nutrients` ─────────────────────────────────────
 *
 * **It never shows a number below the coverage bar.** The `not-enough-data`
 * arm carries no intake figure and no share at all, only the share of the
 * logged GRAMS that carried a figure, which is a fact about the log's data
 * rather than about anybody's intake. A gap exists only for a row whose share
 * is known, which needs both an intake above the bar and a reference amount.
 *
 * **A limit is never a gap.** A ceiling row (sodium today) can only appear in
 * `overLimits`, and only above its limit; `pickLightestNutrients` already keeps
 * it out of the gaps.
 *
 * ── WHY THERE ARE NO GAPS WITHOUT A REFERENCE ──────────────────────────────
 *
 * A gap is a share of a reference amount, and a reference amount needs body
 * metrics and a reachable reference list. When either is missing there is no
 * share to rank, so the snapshot names the reason (`references`) and carries
 * empty `gaps` and `overLimits`, rather than a list that looks complete.
 */
import type { NutrientKey } from '#app/lib/micronutrients';
import { isAboveReferenceLimit, pickLightestNutrients } from '#app/lib/nutrient-reference';
import type { NutrientRow } from '#app/lib/nutrient-reference';

/** How many gaps a pane names. Three is a shortlist; the full ranking is the deep dive's. */
export const SNAPSHOT_GAP_LIMIT = 3;

/**
 * Whether the gaps could be worked out, and the reason when they could not.
 *
 * - `available`: the reference list loaded and the body metrics resolve a band.
 * - `no-body-metrics`: no sex or no year of birth is stored, so no reference
 *   amount applies. Checked first, because it is the one the person can fix.
 * - `unreachable`: the reference list came back empty (offline, or the food
 *   database is not configured).
 * - `age-out-of-bands`: the year of birth is below the youngest published band.
 */
export type SnapshotReferences = 'available' | 'no-body-metrics' | 'unreachable' | 'age-out-of-bands';

/** One nutrient the log was light on, with its share of the reference amount. */
export interface SnapshotGap {
  key: NutrientKey;
  /** Per logged day intake over the reference amount, below `SUGGESTION_SHARE_CEILING`. */
  share: number;
}

/** One ceiling the log went over, in the nutrient's own unit. */
export interface SnapshotOverLimit {
  key: NutrientKey;
  unit: string;
  /** Per logged day intake. */
  amount: number;
  /** The published limit it is above. */
  limit: number;
}

/** The window had covered nutrients, so the pane can count them and, with references, rank them. */
export interface ReadySnapshot {
  kind: 'ready';
  /** Displayed nutrients whose intake cleared the coverage bar. At least 1. */
  coveredCount: number;
  /** Displayed nutrients in all. */
  totalCount: number;
  references: SnapshotReferences;
  /** Up to `SNAPSHOT_GAP_LIMIT` target rows, lowest share first. Empty unless `references` is `available`. */
  gaps: SnapshotGap[];
  /** Ceiling rows above their limit. Empty unless `references` is `available`. */
  overLimits: SnapshotOverLimit[];
}

/** Food was logged, but no displayed nutrient cleared the coverage bar. */
export interface NotEnoughDataSnapshot {
  kind: 'not-enough-data';
  /**
   * The highest share of the window's logged grams that carried a figure for
   * any one displayed nutrient, in `0..1` and below the coverage bar. `0` for
   * a window of AI estimates and typed-in foods only.
   */
  bestCoveredFraction: number;
}

/** Nothing was logged in the window. */
export interface EmptySnapshot {
  kind: 'empty';
}

export type MicronutrientSnapshot = ReadySnapshot | NotEnoughDataSnapshot | EmptySnapshot;

/** What the builder reads: the rows and the facts about the window they came from. */
export interface MicronutrientSnapshotInput {
  /** `buildNutrientRows`' output for the window. */
  rows: readonly NutrientRow[];
  /** Entries logged in the window. `0` is the empty window. */
  totalEntries: number;
  /** Whether the reference list came back with anything in it. */
  referencesReachable: boolean;
  /** Whether both a biological sex and a year of birth are stored. */
  hasBodyMetrics: boolean;
}

/**
 * Why there are or are not gaps, in the order a person can act on them.
 *
 * @param input - the rows and the two facts about the references.
 * @returns the references state.
 */
function resolveSnapshotReferences({
  rows,
  referencesReachable,
  hasBodyMetrics,
}: Pick<MicronutrientSnapshotInput, 'rows' | 'referencesReachable' | 'hasBodyMetrics'>): SnapshotReferences {
  if (!hasBodyMetrics) return 'no-body-metrics';
  if (!referencesReachable) return 'unreachable';
  // The year of birth is the same for every row, so one row refusing on age
  // means every row with a published reference refuses on it.
  if (rows.some((row) => row.reference.kind === 'age-out-of-bands')) return 'age-out-of-bands';
  return 'available';
}

/**
 * The ceiling rows above their limit, with both figures. A row qualifies only
 * through `isAboveReferenceLimit`, so the pane and `/nutrients` say "above"
 * about the same rows.
 *
 * @param rows - every displayed row.
 * @returns the rows over their limit, in display order.
 */
function selectOverLimits(rows: readonly NutrientRow[]): SnapshotOverLimit[] {
  return rows.flatMap((row) => {
    if (!isAboveReferenceLimit(row)) return [];
    if (row.perDayAmount === null || row.reference.kind !== 'available') return [];
    return [{ key: row.key, unit: row.unit, amount: row.perDayAmount, limit: row.reference.amount }];
  });
}

/**
 * Reduces one window's nutrient rows to the snapshot an overview pane draws.
 *
 * @param input - the rows, the entry count, and whether references and body metrics are there.
 * @returns `empty`, `not-enough-data`, or `ready` with its gaps and limits.
 */
export function buildMicronutrientSnapshot(input: MicronutrientSnapshotInput): MicronutrientSnapshot {
  const { rows, totalEntries } = input;
  if (totalEntries === 0) return { kind: 'empty' };

  const coveredCount = rows.filter((row) => row.intake.hasEnoughData).length;
  if (coveredCount === 0) {
    const bestCoveredFraction = Math.max(0, ...rows.map((row) => row.intake.coveredFraction));
    return { kind: 'not-enough-data', bestCoveredFraction };
  }

  const references = resolveSnapshotReferences(input);
  const isRanked = references === 'available';
  return {
    kind: 'ready',
    coveredCount,
    totalCount: rows.length,
    references,
    gaps:
      isRanked ?
        pickLightestNutrients(rows, { limit: SNAPSHOT_GAP_LIMIT }).flatMap((row) =>
          row.share === null ? [] : [{ key: row.key, share: row.share }],
        )
      : [],
    overLimits: isRanked ? selectOverLimits(rows) : [],
  };
}
