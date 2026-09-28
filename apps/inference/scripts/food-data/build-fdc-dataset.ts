/**
 * Generates `data/fdc-foods.json` — the DEFAULT nutrition corpus this service
 * resolves against — from USDA FoodData Central bulk CSV releases.
 *
 * Run it with:
 *
 *   pnpm food-data:fdc                      # download + build
 *   pnpm food-data:fdc --keep-work           # leave the extracted CSVs in place
 *   pnpm food-data:fdc --work-dir /tmp/fdc   # reuse an existing download
 *
 * WHY A GENERATOR PLUS A COMMITTED ARTIFACT, rather than a runtime download.
 * The success criterion for the default backend is "a self-hoster gets working
 * macros with no key, no account, and no outbound call to anyone, including us"
 * (spec 04, OPEN TASK). A first-run download would fail that on an air-gapped
 * box and would put *somebody's* uptime in the middle of a local install. So the
 * artifact ships. It is ~1 MB of JSON, which is cheaper than the argument.
 *
 * WHY THESE TWO DATASETS. Foundation Foods (current, lab-analysed, ~400 rows)
 * and SR Legacy (the classic ~7.8 k-row generic reference table). Both are
 * works of the US federal government — public domain / CC0, so we may
 * redistribute them outright, which is exactly why this is the default rather
 * than OpenFoodFacts (ODbL share-alike) or LCC (BLS forbids redistribution).
 * BRANDED FOODS IS DELIBERATELY EXCLUDED: ~2 M rows of manufacturer label data,
 * hundreds of MB, and dominated by brand strings that drown a query like
 * "scrambled eggs" in "EGGS, SCRAMBLED" ready-meals. Generic plate
 * identification wants the generic table.
 *
 * NUTRIENT IDS ARE NOT TRUSTED FROM MEMORY. `NUTRIENT_IDS` below was verified
 * against `nutrient.csv` in both bundles (2026-08-13), and the fallback chains
 * exist because coverage genuinely differs between them:
 *   - energy: SR Legacy carries 1008 for all 7 793 rows; Foundation carries it
 *     for only 97 and reports 2047/2048 (Atwater) for ~300. Without the chain,
 *     three quarters of Foundation Foods would have a null kcal.
 *   - sugars: Foundation uses 1063, SR Legacy uses 2000. Different ids, same
 *     quantity.
 *   - carbohydrate: 1005 ("by difference") everywhere, with 1050 ("by
 *     summation") as a Foundation-only fallback for 32 rows.
 *
 * A missing nutrient becomes `null`. It is NEVER 0 and never derived — a
 * fabricated macro is the one failure mode this whole milestone exists to avoid.
 *
 * PREREQUISITE: `unzip` on PATH. USDA ships ZIPs, Node has no stdlib unzip, and
 * adding a zip dependency to a repo whose whole pitch is a small audited
 * dependency tree is a bad trade for a script only maintainers run.
 */
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Verified reachable 2026-08-13 (HTTP 200, `Content-Type: application/zip`). */
const SOURCES = [
  {
    key: 'foundation',
    /** `data_type` value in `food.csv` that selects this dataset's real food rows. */
    dataType: 'foundation_food',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2025-04-24.zip',
    /** Directory the ZIP expands to. */
    dir: 'FoodData_Central_foundation_food_csv_2025-04-24',
    release: '2025-04-24',
    /**
     * Preference rank on a name collision — Foundation wins over SR Legacy
     * because it is a current lab analysis rather than a 2018 snapshot.
     */
    priority: 2,
  },
  {
    key: 'sr_legacy',
    dataType: 'sr_legacy_food',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip',
    dir: 'FoodData_Central_sr_legacy_food_csv_2018-04',
    release: '2018-04',
    priority: 1,
  },
] as const;

/**
 * FDC `nutrient.id` → our macro field, in FALLBACK ORDER (first non-empty wins).
 * See the module header for why each chain has more than one entry.
 */
const NUTRIENT_IDS = {
  /** 1005 = "Carbohydrate, by difference"; 1050 = "Carbohydrate, by summation". */
  carbs: ['1005', '1050'],
  /** 1079 = "Fiber, total dietary"; 2033 = "Total dietary fiber (AOAC 2011.25)". */
  fiber: ['1079', '2033'],
  /** 1063 = "Sugars, Total" (Foundation); 2000 = "Total Sugars" (SR Legacy). */
  sugars: ['1063', '2000'],
  /** 1086 = "Total sugar alcohols". Present in the nutrient table, ~absent in the data — honest null. */
  polyols: ['1086'],
  /** 1003 = "Protein". */
  protein: ['1003'],
  /** 1004 = "Total lipid (fat)". */
  fat: ['1004'],
  /** 1008 = "Energy"; 2047/2048 = "Energy (Atwater General/Specific Factors)". All KCAL. */
  kcal: ['1008', '2047', '2048'],
} as const satisfies Record<string, readonly string[]>;

type MacroField = keyof typeof NUTRIENT_IDS;
// SAFETY: the keys of a `const` object literal are exactly its key union —
// `Object.keys` is what widened them to `string`.
const MACRO_FIELDS = Object.keys(NUTRIENT_IDS) as MacroField[];

/** Every nutrient id we care about, for cheap row filtering while streaming. */
const WANTED_NUTRIENT_IDS = new Set<string>(Object.values(NUTRIENT_IDS).flat());

interface FdcFoodRow {
  id: string;
  name: string;
  category: string | null;
  macrosPer100g: Record<MacroField, number | null>;
}

////////////////////////////////////////////////////////////////////////////////
// CSV
////////////////////////////////////////////////////////////////////////////////

/**
 * RFC 4180 scanner. Hand-rolled for the same reason `src/logger.ts` is: one more
 * dependency in a public repo costs a self-hoster an audit, and this is thirty
 * lines. It handles the two things a `split(',')` cannot and that FDC actually
 * contains — commas and doubled quotes inside quoted fields — plus embedded
 * newlines, which are legal here and would silently truncate a line-based parse.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      if (text[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }
      quoted = false;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Reads a CSV into records keyed by its header row. */
async function readCsvRecords(path: string): Promise<Array<Record<string, string>>> {
  const rows = parseCsv(await readFile(path, 'utf8'));
  const header = rows.shift();
  if (!header) throw new Error(`Empty CSV: ${path}`);
  return rows.map((row) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < header.length; index += 1) record[header[index]] = row[index] ?? '';
    return record;
  });
}

////////////////////////////////////////////////////////////////////////////////
// Download + extract
////////////////////////////////////////////////////////////////////////////////

async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  // SAFETY: `response.body` is checked non-null above. The assertion bridges a
  // types-only mismatch — `@types/node`'s `fromWeb` wants its own
  // `ReadableStream` while `fetch` hands back the DOM one; they are the same
  // object at runtime.
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
}

async function ensureUnzip(): Promise<void> {
  try {
    await execFileAsync('unzip', ['-v']);
  } catch {
    throw new Error(
      '`unzip` is not on PATH. USDA ships ZIP archives and this script shells out rather than ' +
        'adding a zip dependency to the runtime tree. Install unzip and re-run.',
    );
  }
}

////////////////////////////////////////////////////////////////////////////////
// Mapping
////////////////////////////////////////////////////////////////////////////////

/** Collapses whitespace. Names are kept verbatim otherwise — retrieval lowercases its own copy. */
function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** How many macro fields this row actually knows — the collision tiebreak. */
function knownMacroCount(row: FdcFoodRow): number {
  return MACRO_FIELDS.filter((field) => row.macrosPer100g[field] !== null).length;
}

/**
 * A row with no energy AND no macronutrient tells a user nothing, so it is
 * dropped rather than shipped as an all-null match that would look like a
 * successful resolution while carrying no information.
 */
function isUseful(row: FdcFoodRow): boolean {
  const { carbs, protein, fat, kcal } = row.macrosPer100g;
  return carbs !== null || protein !== null || fat !== null || kcal !== null;
}

async function buildSourceRows(
  source: (typeof SOURCES)[number],
  workDir: string,
): Promise<FdcFoodRow[]> {
  const base = join(workDir, source.dir);

  const categories = new Map<string, string>();
  for (const record of await readCsvRecords(join(base, 'food_category.csv'))) {
    categories.set(record.id, cleanName(record.description));
  }

  const foods = new Map<string, FdcFoodRow>();
  for (const record of await readCsvRecords(join(base, 'food.csv'))) {
    if (record.data_type !== source.dataType) continue;
    const name = cleanName(record.description);
    if (name.length === 0) continue;
    foods.set(record.fdc_id, {
      id: `fdc:${record.fdc_id}`,
      name,
      category: categories.get(record.food_category_id) ?? null,
      macrosPer100g: {
        carbs: null,
        fiber: null,
        sugars: null,
        polyols: null,
        protein: null,
        fat: null,
        kcal: null,
      },
    });
  }

  /** fdc_id → nutrient_id → amount. Only the ids we map, so this stays small. */
  const amounts = new Map<string, Map<string, number>>();
  for (const record of await readCsvRecords(join(base, 'food_nutrient.csv'))) {
    if (!WANTED_NUTRIENT_IDS.has(record.nutrient_id)) continue;
    if (!foods.has(record.fdc_id)) continue;
    const amount = Number.parseFloat(record.amount);
    // An unparseable or negative amount is missing data, not zero.
    if (!Number.isFinite(amount) || amount < 0) continue;
    const perFood = amounts.get(record.fdc_id) ?? new Map<string, number>();
    // First occurrence wins: FDC can carry several rows for one nutrient
    // (different lab methods); averaging them would invent a figure USDA
    // never published.
    if (!perFood.has(record.nutrient_id)) perFood.set(record.nutrient_id, amount);
    amounts.set(record.fdc_id, perFood);
  }

  const rows: FdcFoodRow[] = [];
  for (const [fdcId, food] of foods) {
    const perFood = amounts.get(fdcId);
    if (perFood) {
      for (const field of MACRO_FIELDS) {
        for (const nutrientId of NUTRIENT_IDS[field]) {
          const amount = perFood.get(nutrientId);
          if (amount === undefined) continue;
          food.macrosPer100g[field] = Math.round(amount * 100) / 100;
          break;
        }
      }
    }
    if (isUseful(food)) rows.push(food);
  }
  return rows;
}

////////////////////////////////////////////////////////////////////////////////
// Main
////////////////////////////////////////////////////////////////////////////////

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const keepWork = process.argv.includes('--keep-work');
  const workDir = resolve(argValue('--work-dir') ?? join(repoRoot, '.fdc-work'));
  const outFile = join(repoRoot, 'data/fdc-foods.json');

  await ensureUnzip();
  await mkdir(workDir, { recursive: true });
  await mkdir(dirname(outFile), { recursive: true });

  const perSource: Array<{ key: string; rows: FdcFoodRow[]; priority: number }> = [];
  for (const source of SOURCES) {
    const zipPath = join(workDir, `${source.key}.zip`);
    const extracted = join(workDir, source.dir, 'food.csv');
    if (!(await readFile(extracted).then(() => true).catch(() => false))) {
      process.stdout.write(`Downloading ${source.url}\n`);
      await download(source.url, zipPath);
      await execFileAsync('unzip', ['-oq', zipPath, '-d', workDir]);
    } else {
      process.stdout.write(`Reusing extracted ${source.dir}\n`);
    }
    const rows = await buildSourceRows(source, workDir);
    process.stdout.write(`  ${source.key}: ${rows.length} usable rows\n`);
    perSource.push({ key: source.key, rows, priority: source.priority });
  }

  // Dedupe on normalized name. Higher-priority dataset wins; within one
  // dataset the row that knows more macros wins.
  const best = new Map<string, { row: FdcFoodRow; priority: number }>();
  let collisions = 0;
  for (const { rows, priority } of perSource.toSorted((a, b) => b.priority - a.priority)) {
    for (const row of rows) {
      const key = normalizeKey(row.name);
      const existing = best.get(key);
      if (!existing) {
        best.set(key, { row, priority });
        continue;
      }
      collisions += 1;
      const better =
        priority > existing.priority ||
        (priority === existing.priority && knownMacroCount(row) > knownMacroCount(existing.row));
      if (better) best.set(key, { row, priority });
    }
  }

  const foods = [...best.values()]
    .map((entry) => entry.row)
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const payload = {
    _meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      generator: 'scripts/food-data/build-fdc-dataset.ts',
      rowCount: foods.length,
      duplicateNamesDropped: collisions,
      license: 'Public domain (CC0) — a work of the U.S. federal government.',
      /** Null on purpose: FDC is a U.S. federal work, so no credit line is owed. */
      attribution: null,
      basis: 'per 100 g edible portion',
      nutrientIds: NUTRIENT_IDS,
      sources: SOURCES.map((source) => ({
        dataset: source.key,
        release: source.release,
        url: source.url,
      })),
      notes:
        'Branded Foods is excluded on purpose (millions of manufacturer rows, ' +
        'and brand strings crowd out generic matches). A null macro means USDA ' +
        'publishes no value for it — it is never zero and never derived.',
    },
    foods,
  };

  await writeFile(outFile, `${JSON.stringify(payload)}\n`, 'utf8');
  process.stdout.write(
    `Wrote ${outFile} — ${foods.length} foods, ${collisions} duplicate names dropped\n`,
  );

  if (!keepWork) await rm(workDir, { recursive: true, force: true });
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
