/**
 * Reads a YAZIO diary export into openplate food-log entries (M254/01).
 *
 * The input is the two files the open-source `yazio-exporter` tool writes,
 * `days.json` and `products.json`, already parsed from JSON, plus its optional
 * `weight.json` (M254/06). Every key read here is sourced in
 * `.tracker/M254-openplate-yazio-import/research/PROVENANCE.md` in the
 * workspace; the synthetic copies in `tests/fixtures/yazio/` follow it.
 *
 * Pure: no store, no DOM, no clock. The caller passes the time zone the
 * wall-clock dates are read in and the creation instant, and writes the
 * entries itself. One item that cannot be read is skipped and counted; only a
 * file that is not the right file at all throws.
 */
import { z } from 'zod';

import type { LocalFoodLog, LocalWeightEntry } from '#app/lib/local-store/schema';
import type { Macros } from '#app/lib/macros';
import { mealTypeForMinutes } from '#app/lib/meal-time';
import { instantAtWallClock, isValidTimeZone, parseDateParam, type WallClockTime } from '#app/lib/user-days';
import { YAZIO_ENTRY_ID_PREFIX, isYazioImportId } from '#app/lib/yazio-ids';
import type { MealType } from '#types/enums';

/** Which of the three exporter files a parsed JSON value is. */
export type YazioFileKind = 'days' | 'products' | 'weight';

/** Why an eaten item did not become an entry. */
export const YAZIO_SKIP_REASONS = [
  'missing-product',
  'missing-recipe',
  'recipe-without-weight',
  'quick-entry',
  'invalid-item',
] as const;
export type YazioSkipReason = (typeof YAZIO_SKIP_REASONS)[number];

export { YAZIO_ENTRY_ID_PREFIX, isYazioImportId };

/** What an import would write, for the preview before anything is written. */
export interface YazioImportReport {
  entryCount: number;
  /** Distinct `dayKey`s among the entries. */
  dayCount: number;
  /** The earliest entry day as `YYYY-MM-DD`, or null when there are no entries. */
  firstDay: string | null;
  /** The latest entry day as `YYYY-MM-DD`, or null when there are no entries. */
  lastDay: string | null;
  skipped: Record<YazioSkipReason, number>;
}

export interface YazioImport {
  entries: LocalFoodLog[];
  report: YazioImportReport;
  /** The weigh-ins in `weight.json`, or null when no weight file was picked. */
  weight: YazioWeightImport | null;
}

/**
 * The weigh-ins a `weight.json` holds, before the diary is consulted: repeats
 * collapsed, implausible values left out. {@link planYazioWeighIns} then drops
 * the days that already hold a weigh-in of the person's own.
 */
export interface YazioWeightImport {
  /** One per weigh-in, oldest day first, each id `yazio-weight-<dayKey>`. */
  weighIns: LocalWeightEntry[];
  /** Weigh-ins whose value is not a number of kilograms from 20 to 350, or whose day is not a date. */
  skippedCount: number;
}

/** What the import will write to the weight log, once the diary's own weigh-ins are respected. */
export interface YazioWeighInPlan {
  /** The weigh-ins to write, oldest day first. */
  weighIns: LocalWeightEntry[];
  /** Import days skipped because they already hold a weigh-in the person logged in openplate. */
  alreadyLoggedDays: number;
  /** The weight of the oldest weigh-in to write, or null when there is none. */
  firstKg: number | null;
  /** The weight of the newest weigh-in to write, or null when there is none. */
  lastKg: number | null;
}

/** A file that is not the exporter file it was passed as. The screen names `file` to the person. */
export class YazioFileError extends Error {
  readonly file: YazioFileKind;

  constructor(file: YazioFileKind) {
    super(`Not a YAZIO ${file}.json export`);
    this.name = 'YazioFileError';
    this.file = file;
  }
}

////////////////////////////////////////////////////////////////////////////////
// The two files
////////////////////////////////////////////////////////////////////////////////

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Items stay unparsed here so one bad item is skipped alone instead of failing its file. */
const consumedSchema = z.object({
  products: z.array(z.unknown()).default([]),
  recipe_portions: z.array(z.unknown()).default([]),
  simple_products: z.array(z.unknown()).default([]),
});

const daySchema = z.object({
  consumed: consumedSchema.default({ products: [], recipe_portions: [], simple_products: [] }),
});

const daysFileSchema = z
  .record(z.string().regex(DAY_KEY_PATTERN), daySchema)
  .refine((days) => Object.keys(days).length > 0, { message: 'A days file names at least one day' });

const productsFileSchema = z.object({
  products: z.record(z.string(), z.unknown()),
  recipes: z.record(z.string(), z.unknown()).default({}),
});

/**
 * `weight.json`, `{ "YYYY-MM-DD": kilograms }` (PROVENANCE, "export-all").
 * A value is kept unread here so one bad value is skipped alone. An object or
 * an array as a value is not this file at all, which is what keeps a days
 * file with one broken day from being read as weights. An empty file is a
 * weight file with no weigh-ins.
 */
const weightFileSchema = z.record(
  z.string().regex(DAY_KEY_PATTERN),
  z.union([z.number(), z.string(), z.boolean(), z.null()]),
);

/** A weight openplate will believe, in kilograms. Outside this range it is a typo or another unit. */
const MIN_PLAUSIBLE_WEIGHT_KG = 20;
const MAX_PLAUSIBLE_WEIGHT_KG = 350;
const plausibleWeightSchema = z.number().min(MIN_PLAUSIBLE_WEIGHT_KG).max(MAX_PLAUSIBLE_WEIGHT_KG);

/** YAZIO keeps no time of day for a weigh-in; noon keeps the instant inside its day in any zone. */
const WEIGH_IN_WALL_CLOCK: WallClockTime = { hour: 12, minute: 0, second: 0 };

////////////////////////////////////////////////////////////////////////////////
// One item
////////////////////////////////////////////////////////////////////////////////

/** `"YYYY-MM-DD HH:MM:SS"`, local wall clock, no zone. */
const ITEM_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

const itemDateSchema = z.string().transform((value, context) => {
  const match = ITEM_DATE_PATTERN.exec(value);
  const dayKey = parseDateParam(match?.[1] ?? null);
  const time = { hour: Number(match?.[2]), minute: Number(match?.[3]), second: Number(match?.[4]) };
  if (dayKey === null || !(time.hour <= 23 && time.minute <= 59 && time.second <= 59)) {
    context.addIssue({ code: 'custom', message: `Not a YAZIO item date: ${value}` });
    return z.NEVER;
  }
  return { dayKey, time };
});

/** An unknown or absent `daytime` becomes null, and the slot then follows the clock. */
const daytimeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']).nullable().catch(null);

/** A nutrient that is not a finite number reads as unknown, never as 0. */
const nutrientsSchema = z.record(z.string(), z.number().nullable().catch(null));
type Nutrients = z.infer<typeof nutrientsSchema>;

const consumedProductSchema = z.object({
  id: z.string().min(1),
  date: itemDateSchema,
  daytime: daytimeSchema,
  product_id: z.string().min(1),
  /** In the product's base unit, gram or millilitre. */
  amount: z.number().positive(),
});

const consumedRecipePortionSchema = z.object({
  id: z.string().min(1),
  date: itemDateSchema,
  daytime: daytimeSchema,
  recipe_id: z.string().min(1),
  portion_count: z.number().positive(),
});

/** Nutrients are per ONE base unit (PROVENANCE: olive oil reads 8.84 kcal/g). */
const productSchema = z.object({
  name: z.string().min(1),
  base_unit: z.enum(['g', 'ml']),
  nutrients: nutrientsSchema,
});

/** Nutrients are per ONE portion, as the exporter's own formatter reads them. */
const recipeSchema = z.object({
  name: z.string().min(1),
  portion_count: z.number().positive().nullable().catch(null),
  nutrients: nutrientsSchema,
  servings: z.array(z.unknown()).catch([]),
});
type Recipe = z.infer<typeof recipeSchema>;

/** One ingredient of a recipe; `amount` is in its base unit, like a consumed product's. */
const ingredientSchema = z.object({
  amount: z.number().nonnegative(),
  base_unit: z.enum(['g', 'ml']),
});

type ItemOutcome = { kind: 'entry'; entry: LocalFoodLog } | { kind: 'skipped'; reason: YazioSkipReason };

interface Catalog {
  products: ReadonlyMap<string, unknown>;
  recipes: ReadonlyMap<string, unknown>;
}

interface EntryContext {
  timeZone: string;
  now: number;
}

////////////////////////////////////////////////////////////////////////////////
// Public API
////////////////////////////////////////////////////////////////////////////////

/**
 * Says which exporter file a parsed JSON value is, by its content, never by
 * its file name.
 *
 * @param options.json - the value `JSON.parse` returned for one picked file.
 * @returns `days`, `products`, or null for anything else.
 */
export function identifyYazioFile({ json }: { json: unknown }): YazioFileKind | null {
  if (productsFileSchema.safeParse(json).success) return 'products';
  if (daysFileSchema.safeParse(json).success) return 'days';
  // Last, because an empty object is a weight file with no weigh-ins.
  if (weightFileSchema.safeParse(json).success) return 'weight';
  return null;
}

/** Why a pick of files cannot be imported, in the order they are checked. */
export type YazioPickError = 'unreadable' | 'unrecognised' | 'duplicate' | 'missing-days' | 'missing-products';

/**
 * A pick of files, sorted into the two the importer needs and the optional
 * weight file (null when it was not picked), or the first reason it cannot be.
 */
export type YazioPick =
  { kind: 'ready'; days: unknown; products: unknown; weight: unknown } | { kind: 'error'; error: YazioPickError };

/**
 * Sorts the text of every picked file into `days`, `products` and the
 * optional `weight`, by content. Any file that is not JSON makes the pick
 * unreadable, any JSON that is none of the three makes it unrecognised, and
 * two of one kind make it a duplicate; only then is a missing file named.
 *
 * @param options.texts - the text of each picked file, in any order.
 * @returns the parsed files, `weight` null when none was picked, or the reason the pick fails.
 */
export function sortYazioFiles({ texts }: { texts: readonly string[] }): YazioPick {
  const parsed: unknown[] = [];
  for (const text of texts) {
    try {
      parsed.push(JSON.parse(text));
    } catch {
      return { kind: 'error', error: 'unreadable' };
    }
  }
  const kinds = parsed.map((json) => identifyYazioFile({ json }));
  if (kinds.includes(null)) return { kind: 'error', error: 'unrecognised' };
  const daysAt = kinds.indexOf('days');
  const productsAt = kinds.indexOf('products');
  const weightAt = kinds.indexOf('weight');
  if (new Set(kinds).size !== kinds.length) return { kind: 'error', error: 'duplicate' };
  if (daysAt === -1) return { kind: 'error', error: 'missing-days' };
  if (productsAt === -1) return { kind: 'error', error: 'missing-products' };
  return { kind: 'ready', days: parsed[daysAt], products: parsed[productsAt], weight: parsed[weightAt] ?? null };
}

/**
 * How many of the import's days already hold an entry the person logged in
 * openplate. Those days show both sets of entries after the import. A day
 * whose only rows carry {@link YAZIO_ENTRY_ID_PREFIX} came from an earlier
 * import of the same files, which this one rewrites, so it does not count.
 *
 * @param options.importDayKeys - the `dayKey` of every entry the import would write.
 * @param options.existingLogs - the diary's entries, at least those on the import's days.
 * @returns the number of import days with an entry of the person's own.
 */
export function countDaysAlreadyLogged({
  importDayKeys,
  existingLogs,
}: {
  importDayKeys: readonly string[];
  existingLogs: readonly Pick<LocalFoodLog, 'id' | 'dayKey'>[];
}): number {
  const importDays = new Set(importDayKeys);
  const loggedDays = new Set(
    existingLogs.filter((log) => !isYazioImportId(log.id) && importDays.has(log.dayKey)).map((log) => log.dayKey),
  );
  return loggedDays.size;
}

/**
 * Which of the file's weigh-ins the import writes. A day that already holds a
 * weigh-in the person logged in openplate is never overwritten; it is
 * skipped and counted. A day holding only this import's own weigh-in (same
 * id, an earlier import of the same file) is written again, like a food entry.
 *
 * @param options.weighIns - the file's weigh-ins, from {@link parseYazioExport}.
 * @param options.existingEntries - every weigh-in in the weight log.
 * @returns the weigh-ins to write and the numbers the preview shows.
 */
export function planYazioWeighIns({
  weighIns,
  existingEntries,
}: {
  weighIns: readonly LocalWeightEntry[];
  existingEntries: readonly Pick<LocalWeightEntry, 'id' | 'dayKey'>[];
}): YazioWeighInPlan {
  const ownDays = new Set(existingEntries.filter((entry) => !isYazioImportId(entry.id)).map((entry) => entry.dayKey));
  const toWrite = weighIns
    .filter((entry) => !ownDays.has(entry.dayKey))
    .toSorted((a, b) => a.dayKey.localeCompare(b.dayKey));
  return {
    weighIns: toWrite,
    alreadyLoggedDays: weighIns.length - toWrite.length,
    firstKg: toWrite[0]?.weightKg ?? null,
    lastKg: toWrite.at(-1)?.weightKg ?? null,
  };
}

/**
 * Turns the exporter files into food-log entries, weigh-ins and a preview report.
 *
 * @param options.days - the parsed `days.json`.
 * @param options.products - the parsed `products.json`.
 * @param options.weight - the parsed `weight.json`, or null (the default) when none was picked.
 * @param options.timeZone - the IANA zone the export's wall-clock dates are read in.
 * @param options.now - epoch ms, stamped as every entry's and weigh-in's `createdAt`.
 * @returns the entries, ready for `putLocalFoodLog`, the report, and the weigh-ins.
 * @throws {YazioFileError} when a file is not the exporter file it was passed as.
 */
export function parseYazioExport({
  days,
  products,
  weight = null,
  timeZone,
  now,
}: {
  days: unknown;
  products: unknown;
  weight?: unknown;
  timeZone: string;
  now: number;
}): YazioImport {
  const daysFile = daysFileSchema.safeParse(days);
  if (!daysFile.success) throw new YazioFileError('days');
  const productsFile = productsFileSchema.safeParse(products);
  if (!productsFile.success) throw new YazioFileError('products');
  const weightFile = weight === null ? null : weightFileSchema.safeParse(weight);
  if (weightFile !== null && !weightFile.success) throw new YazioFileError('weight');
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid IANA time zone: ${timeZone}`);

  const catalog: Catalog = {
    products: new Map(Object.entries(productsFile.data.products)),
    recipes: new Map(Object.entries(productsFile.data.recipes)),
  };
  const context: EntryContext = { timeZone, now };

  const outcomes: ItemOutcome[] = [];
  const sortedDays = Object.entries(daysFile.data).toSorted(([a], [b]) => a.localeCompare(b));
  for (const [, day] of sortedDays) {
    for (const raw of day.consumed.products) outcomes.push(readConsumedProduct({ raw, catalog, context }));
    for (const raw of day.consumed.recipe_portions) outcomes.push(readRecipePortion({ raw, catalog, context }));
    // Decision 7: a quick entry has no known shape, so it is counted and never read.
    outcomes.push(...day.consumed.simple_products.map(() => skip('quick-entry')));
  }

  const weighIns = weightFile === null ? null : readWeighIns({ values: weightFile.data, context });
  return { ...summarize(outcomes), weight: weighIns };
}

////////////////////////////////////////////////////////////////////////////////
// Internals
////////////////////////////////////////////////////////////////////////////////

function skip(reason: YazioSkipReason): ItemOutcome {
  return { kind: 'skipped', reason };
}

function readConsumedProduct({
  raw,
  catalog,
  context,
}: {
  raw: unknown;
  catalog: Catalog;
  context: EntryContext;
}): ItemOutcome {
  const item = consumedProductSchema.safeParse(raw);
  if (!item.success) return skip('invalid-item');
  if (!catalog.products.has(item.data.product_id)) return skip('missing-product');
  const product = productSchema.safeParse(catalog.products.get(item.data.product_id));
  if (!product.success) return skip('invalid-item');

  // Decision 5: a millilitre counts as a gram, openplate stores grams only.
  const entry = buildEntry({
    consumedId: item.data.id,
    name: product.data.name,
    quantityGrams: item.data.amount,
    macros: scaleNutrients({ nutrients: product.data.nutrients, factor: item.data.amount }),
    date: item.data.date,
    daytime: item.data.daytime,
    context,
  });
  return { kind: 'entry', entry };
}

function readRecipePortion({
  raw,
  catalog,
  context,
}: {
  raw: unknown;
  catalog: Catalog;
  context: EntryContext;
}): ItemOutcome {
  const item = consumedRecipePortionSchema.safeParse(raw);
  if (!item.success) return skip('invalid-item');
  if (!catalog.recipes.has(item.data.recipe_id)) return skip('missing-recipe');
  const recipe = recipeSchema.safeParse(catalog.recipes.get(item.data.recipe_id));
  if (!recipe.success) return skip('invalid-item');
  const gramsPerPortion = computeGramsPerPortion(recipe.data);
  if (gramsPerPortion === null) return skip('recipe-without-weight');

  const entry = buildEntry({
    consumedId: item.data.id,
    name: recipe.data.name,
    quantityGrams: gramsPerPortion * item.data.portion_count,
    macros: scaleNutrients({ nutrients: recipe.data.nutrients, factor: item.data.portion_count }),
    date: item.data.date,
    daytime: item.data.daytime,
    context,
  });
  return { kind: 'entry', entry };
}

/** The sum of the ingredient amounts over the recipe's own portion count, or null when any part is unknown. */
function computeGramsPerPortion(recipe: Recipe): number | null {
  if (recipe.portion_count === null || recipe.servings.length === 0) return null;
  let totalGrams = 0;
  for (const raw of recipe.servings) {
    const ingredient = ingredientSchema.safeParse(raw);
    if (!ingredient.success) return null;
    totalGrams += ingredient.data.amount;
  }
  if (totalGrams <= 0) return null;
  return totalGrams / recipe.portion_count;
}

/** Full precision, like `scaleMacrosPer100gToServing`; the screens round for display. */
function scaleNutrients({ nutrients, factor }: { nutrients: Nutrients; factor: number }): Macros {
  const read = (key: string): number | null => {
    const value = nutrients[key] ?? null;
    return value === null ? null : value * factor;
  };
  return {
    carbs: read('nutrient.carb'),
    fiber: read('nutrient.dietaryfiber'),
    sugars: read('nutrient.sugar'),
    // YAZIO carries no polyols key in any source.
    polyols: null,
    protein: read('nutrient.protein'),
    fat: read('nutrient.fat'),
    kcal: read('energy.energy'),
  };
}

function buildEntry({
  consumedId,
  name,
  quantityGrams,
  macros,
  date,
  daytime,
  context,
}: {
  consumedId: string;
  name: string;
  quantityGrams: number;
  macros: Macros;
  date: { dayKey: string; time: WallClockTime };
  daytime: MealType | null;
  context: EntryContext;
}): LocalFoodLog {
  return {
    // Decision 9: the same export imported twice writes the same ids, so it updates instead of duplicating.
    id: `${YAZIO_ENTRY_ID_PREFIX}${consumedId}`,
    name,
    quantityGrams,
    macros,
    mealType: daytime ?? mealTypeForMinutes(date.time.hour * 60 + date.time.minute),
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: date.dayKey,
    loggedAt: instantAtWallClock({ date: date.dayKey, time: date.time, timeZone: context.timeZone }).getTime(),
    createdAt: context.now,
    logBatchId: null,
    // Decision 4: whether YAZIO's carbs include fibre is unknown; `available` errs towards more net carbs.
    carbBasis: 'available',
  };
}

/**
 * The weigh-ins in `weight.json`.
 *
 * THE FILE REPEATS ITSELF. The exporter asks YAZIO for "the latest weight on
 * or before" each date, so one weigh-in is written again on every later day
 * until the next one. A day is a weigh-in only when its value differs from
 * the previous day's in the file, and the first day always is one. Repeats
 * collapse BEFORE a value is judged, so a run of one implausible value counts
 * as one skip, not one per day. Values are kilograms, the exporter's own
 * reading; the preview's range is how a person spots a file in pounds.
 */
function readWeighIns({
  values,
  context,
}: {
  values: Readonly<Record<string, number | string | boolean | null>>;
  context: EntryContext;
}): YazioWeightImport {
  const weighIns: LocalWeightEntry[] = [];
  let skippedCount = 0;
  let previous: number | string | boolean | null | undefined;
  for (const [dayKey, value] of Object.entries(values).toSorted(([a], [b]) => a.localeCompare(b))) {
    const isRepeat = previous !== undefined && Object.is(value, previous);
    previous = value;
    if (isRepeat) continue;
    const weightKg = plausibleWeightSchema.safeParse(value);
    if (!weightKg.success || parseDateParam(dayKey) === null) {
      skippedCount += 1;
      continue;
    }
    weighIns.push({
      // Derived from the day, so the same file imported twice writes the same rows.
      id: `${YAZIO_ENTRY_ID_PREFIX}weight-${dayKey}`,
      dayKey,
      weightKg: weightKg.data,
      loggedAt: instantAtWallClock({ date: dayKey, time: WEIGH_IN_WALL_CLOCK, timeZone: context.timeZone }).getTime(),
      createdAt: context.now,
    });
  }
  return { weighIns, skippedCount };
}

/** Builds the report. A second item with an id already taken is malformed and skipped, so the count matches what lands. */
function summarize(outcomes: readonly ItemOutcome[]): Omit<YazioImport, 'weight'> {
  const entries: LocalFoodLog[] = [];
  const reasons: YazioSkipReason[] = [];
  const seenIds = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.kind === 'skipped') {
      reasons.push(outcome.reason);
      continue;
    }
    if (seenIds.has(outcome.entry.id)) {
      reasons.push('invalid-item');
      continue;
    }
    seenIds.add(outcome.entry.id);
    entries.push(outcome.entry);
  }

  const dayKeys = [...new Set(entries.map((entry) => entry.dayKey))].toSorted();
  return {
    entries,
    report: {
      entryCount: entries.length,
      dayCount: dayKeys.length,
      firstDay: dayKeys[0] ?? null,
      lastDay: dayKeys.at(-1) ?? null,
      skipped: countSkips(reasons),
    },
  };
}

function countSkips(reasons: readonly YazioSkipReason[]) {
  const count = (reason: YazioSkipReason): number => reasons.filter((each) => each === reason).length;
  return {
    'missing-product': count('missing-product'),
    'missing-recipe': count('missing-recipe'),
    'recipe-without-weight': count('recipe-without-weight'),
    'quick-entry': count('quick-entry'),
    'invalid-item': count('invalid-item'),
  } satisfies Record<YazioSkipReason, number>;
}
