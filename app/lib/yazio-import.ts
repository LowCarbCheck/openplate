/**
 * Reads a YAZIO diary export into openplate food-log entries (M254/01).
 *
 * The input is the two files the open-source `yazio-exporter` tool writes,
 * `days.json` and `products.json`, already parsed from JSON. Every key read
 * here is sourced in `.tracker/M254-openplate-yazio-import/research/PROVENANCE.md`
 * in the workspace; the synthetic copies in `tests/fixtures/yazio/` follow it.
 *
 * Pure: no store, no DOM, no clock. The caller passes the time zone the
 * wall-clock dates are read in and the creation instant, and writes the
 * entries itself. One item that cannot be read is skipped and counted; only a
 * file that is not the right file at all throws.
 */
import { z } from 'zod';

import type { LocalFoodLog } from '#app/lib/local-store/schema';
import type { Macros } from '#app/lib/macros';
import { mealTypeForMinutes } from '#app/lib/meal-time';
import { instantAtWallClock, isValidTimeZone, parseDateParam, type WallClockTime } from '#app/lib/user-days';
import type { MealType } from '#types/enums';

/** Which of the two exporter files a parsed JSON value is. */
export type YazioFileKind = 'days' | 'products';

/** Why an eaten item did not become an entry. */
export const YAZIO_SKIP_REASONS = [
  'missing-product',
  'missing-recipe',
  'recipe-without-weight',
  'quick-entry',
  'invalid-item',
] as const;
export type YazioSkipReason = (typeof YAZIO_SKIP_REASONS)[number];

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
  return null;
}

/**
 * Turns the two exporter files into food-log entries and a preview report.
 *
 * @param options.days - the parsed `days.json`.
 * @param options.products - the parsed `products.json`.
 * @param options.timeZone - the IANA zone the export's wall-clock dates are read in.
 * @param options.now - epoch ms, stamped as every entry's `createdAt`.
 * @returns the entries, ready for `putLocalFoodLog`, and the report.
 * @throws {YazioFileError} when either file is not the exporter file it was passed as.
 */
export function parseYazioExport({
  days,
  products,
  timeZone,
  now,
}: {
  days: unknown;
  products: unknown;
  timeZone: string;
  now: number;
}): YazioImport {
  const daysFile = daysFileSchema.safeParse(days);
  if (!daysFile.success) throw new YazioFileError('days');
  const productsFile = productsFileSchema.safeParse(products);
  if (!productsFile.success) throw new YazioFileError('products');
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

  return summarize(outcomes);
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
    id: `yazio-${consumedId}`,
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

/** Builds the report. A second item with an id already taken is malformed and skipped, so the count matches what lands. */
function summarize(outcomes: readonly ItemOutcome[]): YazioImport {
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
