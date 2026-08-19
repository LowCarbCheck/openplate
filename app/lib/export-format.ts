/**
 * Pure serialization core for the data-export feature (functional core; the
 * imperative shell lives in `app/models/export.server.ts`). No DB, network, or
 * `Date.now()` — every input is passed in, so these functions unit-test directly
 * (see `tests/unit/export-format.test.ts`).
 *
 * Callers hand in already-parsed rows (numeric-string columns converted to
 * `number | null` by the shell); these builders shape them into a CSV string or
 * a JSON document. Unknown macros stay `null`/empty — they are never defaulted
 * to `0`. `net_carbs` is DERIVED the way the app derives its daily totals
 * (`carbs − fiber − polyols`, treating unknown fiber/polyols as 0) but only
 * when `carbs` itself is known; a null `carbs` yields a null net-carbs, not 0.
 */
import { encodeCsv } from './csv';
import type { CsvRow } from './csv';

////////////////////////////////////////////////////////////////////////////////
// Request shape (format + selection) with runtime guards
////////////////////////////////////////////////////////////////////////////////

/** Output format of an export request. */
export type ExportFormat = 'csv' | 'json';

/** What an export request covers. `all` is JSON-only (CSV is single-entity). */
export type ExportWhat = 'logs' | 'foods' | 'weights' | 'all';

/** Schema version stamped on the JSON document so future importers can branch. */
export const EXPORT_SCHEMA_VERSION = 1;

const EXPORT_FORMATS: ReadonlySet<string> = new Set<ExportFormat>(['csv', 'json']);
const EXPORT_WHATS: ReadonlySet<string> = new Set<ExportWhat>(['logs', 'foods', 'weights', 'all']);

/** Narrows an arbitrary query-string value to a supported `ExportFormat`. */
export function isExportFormat(value: string): value is ExportFormat {
  return EXPORT_FORMATS.has(value);
}

/** Narrows an arbitrary query-string value to a supported `ExportWhat`. */
export function isExportWhat(value: string): value is ExportWhat {
  return EXPORT_WHATS.has(value);
}

////////////////////////////////////////////////////////////////////////////////
// Parsed input shapes (DB-agnostic; the shell maps Drizzle rows into these)
////////////////////////////////////////////////////////////////////////////////

/** A user's profile as needed for export — goals are null when unset (never 0). */
export interface ExportProfileInput {
  timezone: string;
  goalNetCarbsCeilingG: number | null;
  goalProteinFloorG: number | null;
  goalKcalTarget: number | null;
  targetWeightKg: number | null;
  trackingFocus: string | null;
}

/** A personal master food (per-100g macros); `carbs` is always known. */
export interface ExportFoodInput {
  /** A server row's numeric id, or a local-store client id (M117/03) — CSV output never renders it; JSON output carries it through opaquely. */
  id: number | string;
  name: string;
  brand: string | null;
  carbs: number;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
  protein: number | null;
  fat: number | null;
  kcal: number | null;
  source: string;
  createdAt: Date;
}

/** A single food-log entry (per-serving macro snapshot; every macro nullable). */
export interface ExportLogInput {
  /** A server row's numeric id, or a local-store client id (M117/03) — CSV output never renders it; JSON output carries it through opaquely. */
  id: number | string;
  loggedAt: Date;
  name: string;
  quantityGrams: number;
  carbs: number | null;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
  protein: number | null;
  fat: number | null;
  kcal: number | null;
  mealType: string | null;
  source: string;
  aiEstimated: boolean;
  curatedSource: string | null;
  /** Linked food's id (same id-type note as this row's own `id`), or null. */
  foodId: number | string | null;
  logBatchId: string | null;
  /**
   * The entry's AUTHORITATIVE net carbs for this serving, when one was
   * snapshotted at log time (`LocalFoodLog.netCarbsPer100g`, already scaled by
   * the caller). Wins over deriving from `carbs`/`fiber`/`polyols` — see
   * `computeExportNetCarbs`. Absent/`null` falls back to the derivation.
   */
  netCarbs?: number | null;
}

/** A single weigh-in (one per calendar day). */
export interface ExportWeightInput {
  measuredAt: string;
  weightKg: number;
}

////////////////////////////////////////////////////////////////////////////////
// Net carbs (derived like the app's daily totals)
////////////////////////////////////////////////////////////////////////////////

/**
 * Net carbs for one row: an AUTHORITATIVE figure when the row carries one,
 * else `carbs − fiber − polyols`, with unknown fiber/polyols counted as 0 (the
 * same preference order and convention as `summarizeDay`'s `_entryNetCarbs`).
 * Returns `null` when neither is available — net carbs can't exist without a
 * carb figure, and a 0 there would fabricate one. The derivation is not
 * clamped: a fiber-heavy entry can go negative.
 *
 * The authoritative branch is load-bearing for curated/bls foods, whose
 * `carbs` is already fibre-EXCLUSIVE: deriving from parts double-subtracts the
 * fibre, so an export of a wheat-bran entry would read `-21.1` (or a floored
 * 0 elsewhere) instead of its true 21.7.
 *
 * @param row - the carb/fiber/polyols figures, plus any authoritative `netCarbs`.
 * @returns the row's net carbs, or `null` when unknown.
 */
export function computeExportNetCarbs(row: {
  carbs: number | null;
  fiber: number | null;
  polyols: number | null;
  netCarbs?: number | null;
}): number | null {
  if (row.netCarbs !== undefined && row.netCarbs !== null) return row.netCarbs;
  if (row.carbs === null) return null;
  return row.carbs - (row.fiber ?? 0) - (row.polyols ?? 0);
}

////////////////////////////////////////////////////////////////////////////////
// CSV builders (one entity per file)
////////////////////////////////////////////////////////////////////////////////

const LOG_CSV_HEADER = [
  'logged_at',
  'name',
  'quantity_grams',
  'carbs',
  'fiber',
  'sugars',
  'polyols',
  'protein',
  'fat',
  'kcal',
  'net_carbs',
  'meal',
  'source',
  'ai_estimated',
  'curated_source',
] as const;

/** Builds the food-log CSV (chronological rows in, one column per log field). */
export function buildLogsCsv(rows: readonly ExportLogInput[]): string {
  const csvRows: CsvRow[] = rows.map((row) => [
    row.loggedAt.toISOString(),
    row.name,
    row.quantityGrams,
    row.carbs,
    row.fiber,
    row.sugars,
    row.polyols,
    row.protein,
    row.fat,
    row.kcal,
    computeExportNetCarbs(row),
    row.mealType,
    row.source,
    row.aiEstimated,
    row.curatedSource,
  ]);
  return encodeCsv({ header: LOG_CSV_HEADER, rows: csvRows });
}

const FOOD_CSV_HEADER = [
  'name',
  'brand',
  'carbs',
  'fiber',
  'sugars',
  'polyols',
  'protein',
  'fat',
  'kcal',
  'net_carbs',
  'source',
  'created_at',
] as const;

/** Builds the personal-foods CSV (per-100g macros, one row per master food). */
export function buildFoodsCsv(rows: readonly ExportFoodInput[]): string {
  const csvRows: CsvRow[] = rows.map((row) => [
    row.name,
    row.brand,
    row.carbs,
    row.fiber,
    row.sugars,
    row.polyols,
    row.protein,
    row.fat,
    row.kcal,
    computeExportNetCarbs(row),
    row.source,
    row.createdAt.toISOString(),
  ]);
  return encodeCsv({ header: FOOD_CSV_HEADER, rows: csvRows });
}

const WEIGHT_CSV_HEADER = ['measured_at', 'weight_kg'] as const;

/** Builds the weigh-ins CSV (one row per calendar day). */
export function buildWeightsCsv(rows: readonly ExportWeightInput[]): string {
  const csvRows: CsvRow[] = rows.map((row) => [row.measuredAt, row.weightKg]);
  return encodeCsv({ header: WEIGHT_CSV_HEADER, rows: csvRows });
}

////////////////////////////////////////////////////////////////////////////////
// JSON document (the full "everything" export)
////////////////////////////////////////////////////////////////////////////////

/** A food as it appears in the JSON export (camelCase, numbers as numbers). */
export interface ExportFoodJson {
  id: number | string;
  name: string;
  brand: string | null;
  carbs: number;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
  protein: number | null;
  fat: number | null;
  kcal: number | null;
  netCarbs: number | null;
  source: string;
  createdAt: string;
}

/** A log entry as it appears in the JSON export. */
export interface ExportLogJson {
  id: number | string;
  loggedAt: string;
  name: string;
  quantityGrams: number;
  carbs: number | null;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
  protein: number | null;
  fat: number | null;
  kcal: number | null;
  netCarbs: number | null;
  mealType: string | null;
  source: string;
  aiEstimated: boolean;
  curatedSource: string | null;
  foodId: number | string | null;
  logBatchId: string | null;
}

/** A weigh-in as it appears in the JSON export. */
export interface ExportWeightJson {
  measuredAt: string;
  weightKg: number;
}

/** The full export document — profile + all personal rows, no secrets. */
export interface ExportDocument {
  exportedAt: string;
  schemaVersion: number;
  profile: {
    timezone: string;
    goals: {
      netCarbsCeilingG: number | null;
      proteinFloorG: number | null;
      kcalTarget: number | null;
      trackingFocus: string | null;
    };
    targetWeightKg: number | null;
  };
  foods: ExportFoodJson[];
  logs: ExportLogJson[];
  weights: ExportWeightJson[];
}

/** Maps a parsed food into its JSON export shape. */
function _toFoodJson(food: ExportFoodInput): ExportFoodJson {
  return {
    id: food.id,
    name: food.name,
    brand: food.brand,
    carbs: food.carbs,
    fiber: food.fiber,
    sugars: food.sugars,
    polyols: food.polyols,
    protein: food.protein,
    fat: food.fat,
    kcal: food.kcal,
    netCarbs: computeExportNetCarbs(food),
    source: food.source,
    createdAt: food.createdAt.toISOString(),
  };
}

/** Maps a parsed log entry into its JSON export shape. */
function _toLogJson(log: ExportLogInput): ExportLogJson {
  return {
    id: log.id,
    loggedAt: log.loggedAt.toISOString(),
    name: log.name,
    quantityGrams: log.quantityGrams,
    carbs: log.carbs,
    fiber: log.fiber,
    sugars: log.sugars,
    polyols: log.polyols,
    protein: log.protein,
    fat: log.fat,
    kcal: log.kcal,
    netCarbs: computeExportNetCarbs(log),
    mealType: log.mealType,
    source: log.source,
    aiEstimated: log.aiEstimated,
    curatedSource: log.curatedSource,
    foodId: log.foodId,
    logBatchId: log.logBatchId,
  };
}

/** Maps a parsed weigh-in into its JSON export shape. */
function _toWeightJson(weight: ExportWeightInput): ExportWeightJson {
  return { measuredAt: weight.measuredAt, weightKg: weight.weightKg };
}

/**
 * Assembles the full JSON export document from parsed inputs. Pure — `exportedAt`
 * is passed in (never read from the clock here) so the output is deterministic.
 *
 * @param input - the export instant, profile, and all personal rows.
 * @returns the JSON-serializable export document.
 */
export function buildExportDocument({
  exportedAt,
  profile,
  foods,
  logs,
  weights,
}: {
  exportedAt: Date;
  profile: ExportProfileInput;
  foods: readonly ExportFoodInput[];
  logs: readonly ExportLogInput[];
  weights: readonly ExportWeightInput[];
}): ExportDocument {
  return {
    exportedAt: exportedAt.toISOString(),
    schemaVersion: EXPORT_SCHEMA_VERSION,
    profile: {
      timezone: profile.timezone,
      goals: {
        netCarbsCeilingG: profile.goalNetCarbsCeilingG,
        proteinFloorG: profile.goalProteinFloorG,
        kcalTarget: profile.goalKcalTarget,
        trackingFocus: profile.trackingFocus,
      },
      targetWeightKg: profile.targetWeightKg,
    },
    foods: foods.map(_toFoodJson),
    logs: logs.map(_toLogJson),
    weights: weights.map(_toWeightJson),
  };
}

////////////////////////////////////////////////////////////////////////////////
// Filename
////////////////////////////////////////////////////////////////////////////////

/**
 * Builds the download filename, e.g. `openplate-logs-2026-07-13.csv`. All parts
 * are trusted (validated unions + a `YYYY-MM-DD` date), so no escaping is needed.
 *
 * @param input - the export `what`, `format`, and the user-local `date`.
 * @returns the attachment filename.
 */
export function buildExportFilename({
  what,
  format,
  date,
}: {
  what: ExportWhat;
  format: ExportFormat;
  date: string;
}): string {
  return `openplate-${what}-${date}.${format}`;
}
