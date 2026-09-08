/**
 * The deterministic multi-week diary a reviewer needs on a device before any
 * screen is worth looking at.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────
 *
 * It is not `scripts/landing-seed.ts`. That file is a FROZEN one-day table
 * whose every gram is a design decision, because it feeds published marketing
 * screenshots. This one is a GENERATOR, because the thing it has to produce
 * is not one beautiful day but a spread of STATES: a day over the ceiling
 * beside a day under it, a day with nothing logged at all, all four meal slots
 * plus entries with none, typed entries beside photographed ones, a weight
 * series long enough to draw a line. Writing three weeks of that as a literal
 * table would be unreadable and nobody would ever edit it.
 *
 * What it borrows from `landing-seed.ts` is the lesson, not the data:
 * DETERMINISM. Two runs with the same seed and the same end day produce a
 * byte-identical envelope, so a screenshot diff between them is a real UI
 * change and never the dice. The randomness here picks WHICH food fills a
 * slot; it never picks how much carbohydrate a day carries, which is solved
 * (see {@link solveAnchorGrams}) so each day lands in the band its carb level
 * names.
 *
 * ── The one non-deterministic input, named ───────────────────────────────
 *
 * `endDay` defaults to today in `timezone`, because a diary that ends three
 * weeks ago leaves the dashboard, which shows TODAY, empty. Two runs on
 * different days therefore differ. Pass an explicit `endDay` when you want a
 * fixed artefact, which is what the unit tests do.
 *
 * ── The obviously-fake data rule ─────────────────────────────────────────
 *
 * Ordinary foods, ordinary portions, one plausible weight series, and nothing
 * else. No height, no birth year, no biological sex, no reproductive status,
 * no notes. This file exists to make screens reviewable, and a fixture that
 * reads like a real person's medical record is a privacy smell in a public
 * repository even when every byte of it is invented.
 */
import type { BackupEnvelope } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import type { LocalFoodLog, LocalPersonalFood, LocalWeightEntry } from '../../app/lib/local-store/schema';
import type { Macros } from '../../app/lib/macros';
import { computeNetCarbsFromParts } from '../../app/lib/net-carbs';
import { dayBoundsInTimezone, shiftDate, todayInTimezone } from '../../app/lib/user-days';
import type { MealType } from '../../types/enums';

/** The goals every seeded device is given. The net-carb ceiling is what every day carb level is measured against. */
export const SEED_GOALS = {
  goalNetCarbsCeilingG: 50,
  goalProteinFloorG: 90,
  goalKcalTarget: 1800,
  targetWeightKg: 78,
} as const;

/**
 * What a seeded day is FOR. The four are not decoration: every chart in the
 * app has to tell them apart, and `empty` is the one most often got wrong —
 * an unlogged day and a day whose total is zero are different facts, and a
 * chart that draws them the same way is lying about one of them.
 */
export type SeedDayCarbLevel = 'under' | 'at' | 'over' | 'empty';

/**
 * The day carb levels, indexed by DISTANCE FROM THE END of the diary rather than
 * from its start.
 *
 * Anchored to the end on purpose. The dashboard shows the last day, so index 0
 * must never be `empty` or every review starts on a blank screen; and a
 * reviewer who asks for one week and a reviewer who asks for six must both get
 * the same recent days. The cycle is seven long and carries all four levels,
 * so any whole week of this diary contains one of each.
 */
export const SEED_DAY_CARB_LEVEL_CYCLE: readonly SeedDayCarbLevel[] = [
  'under',
  'at',
  'over',
  'under',
  'empty',
  'at',
  'over',
];

/** Which carb level the day `offsetFromEnd` days before the last one takes. */
export function seedDayCarbLevel(offsetFromEnd: number): SeedDayCarbLevel {
  const level = SEED_DAY_CARB_LEVEL_CYCLE[offsetFromEnd % SEED_DAY_CARB_LEVEL_CYCLE.length];
  if (level === undefined) throw new Error(`No carb level for offset ${offsetFromEnd}`);
  return level;
}

/**
 * Where each carb level aims, as a fraction of the net-carb ceiling.
 *
 * `at` is deliberately just under 1 rather than exactly 1: the app's own
 * "at your ceiling" reading is the interesting one to look at, and a day that
 * lands one tenth of a gram either side of the line would flip between two
 * renderings for no reason a reviewer could see.
 */
const CARB_LEVEL_TARGET_FRACTION = {
  under: 0.5,
  at: 0.94,
  over: 1.3,
  empty: 0,
} satisfies Record<SeedDayCarbLevel, number>;

/** Marks every seeded entry as coming from a food database, so the diary renders its provenance chips. */
const SEED_CURATED_SOURCE = 'seed-catalog';

/** A credit string on the curated half of the catalog, so the licence-attribution surfaces have something to draw. */
const SEED_ATTRIBUTION = 'Seed catalogue (invented figures, not a real food database)';

/** One food in the seed catalogue. Macros are PER 100 G, total-carbohydrate convention (fibre included in `carbs`). */
interface SeedFood {
  /** Stable id fragment; appears in every generated row id. */
  id: string;
  name: string;
  macrosPer100g: Macros;
  /**
   * `true` for the half of the catalogue that pretends to come from a food
   * database: those entries carry a `curatedSource`, an `attribution` and an
   * authoritative `netCarbsPer100g`. The other half pretends to be hand-typed
   * and carries none of the three, which is the mix a real diary has.
   */
  curated: boolean;
}

const BREAKFASTS: readonly SeedFood[] = [
  {
    id: 'scrambled-eggs',
    name: 'Scrambled eggs',
    macrosPer100g: { carbs: 1.1, fiber: 0, sugars: 1.1, polyols: 0, protein: 10.6, fat: 12.2, kcal: 155 },
    curated: false,
  },
  {
    id: 'greek-yoghurt',
    name: 'Greek yoghurt, 10%',
    macrosPer100g: { carbs: 3.6, fiber: 0, sugars: 3.6, polyols: 0, protein: 8.7, fat: 10.2, kcal: 143 },
    curated: true,
  },
  {
    id: 'cottage-cheese',
    name: 'Cottage cheese',
    macrosPer100g: { carbs: 3.4, fiber: 0, sugars: 2.7, polyols: 0, protein: 11.1, fat: 4.3, kcal: 98 },
    curated: true,
  },
];

const PROTEINS: readonly SeedFood[] = [
  {
    id: 'chicken-breast',
    name: 'Grilled chicken breast',
    macrosPer100g: { carbs: 0, fiber: 0, sugars: 0, polyols: 0, protein: 31, fat: 3.6, kcal: 165 },
    curated: true,
  },
  {
    id: 'salmon-fillet',
    name: 'Salmon fillet',
    macrosPer100g: { carbs: 0, fiber: 0, sugars: 0, polyols: 0, protein: 20.4, fat: 13.4, kcal: 208 },
    curated: true,
  },
  {
    id: 'beef-mince',
    name: 'Beef mince, 15% fat',
    macrosPer100g: { carbs: 0, fiber: 0, sugars: 0, polyols: 0, protein: 18.6, fat: 15, kcal: 215 },
    curated: false,
  },
  {
    id: 'firm-tofu',
    name: 'Firm tofu',
    macrosPer100g: { carbs: 1.9, fiber: 0.9, sugars: 0.6, polyols: 0, protein: 17.3, fat: 8.7, kcal: 144 },
    curated: false,
  },
];

const VEGETABLES: readonly SeedFood[] = [
  {
    id: 'broccoli',
    name: 'Steamed broccoli',
    macrosPer100g: { carbs: 7, fiber: 2.6, sugars: 1.7, polyols: 0, protein: 2.8, fat: 0.4, kcal: 35 },
    curated: true,
  },
  {
    id: 'mixed-salad',
    name: 'Mixed leaf salad',
    macrosPer100g: { carbs: 2.9, fiber: 1.3, sugars: 0.8, polyols: 0, protein: 1.4, fat: 0.2, kcal: 17 },
    curated: true,
  },
  {
    id: 'courgette',
    name: 'Roasted courgette',
    macrosPer100g: { carbs: 3.1, fiber: 1, sugars: 2.5, polyols: 0, protein: 1.2, fat: 0.3, kcal: 21 },
    curated: false,
  },
  {
    id: 'spinach',
    name: 'Wilted spinach',
    macrosPer100g: { carbs: 3.6, fiber: 2.2, sugars: 0.4, polyols: 0, protein: 2.9, fat: 0.4, kcal: 23 },
    curated: true,
  },
];

const SNACKS: readonly SeedFood[] = [
  {
    id: 'almonds',
    name: 'Almonds',
    macrosPer100g: { carbs: 21.6, fiber: 12.5, sugars: 4.4, polyols: 0, protein: 21.2, fat: 49.4, kcal: 579 },
    curated: true,
  },
  {
    id: 'walnuts',
    name: 'Walnuts',
    macrosPer100g: { carbs: 13.7, fiber: 6.7, sugars: 2.6, polyols: 0, protein: 15.2, fat: 65.2, kcal: 654 },
    curated: false,
  },
  {
    id: 'cheddar',
    name: 'Cheddar',
    macrosPer100g: { carbs: 1.3, fiber: 0, sugars: 0.5, polyols: 0, protein: 25, fat: 33.1, kcal: 403 },
    curated: false,
  },
];

/** The unslotted entries: small, late, and the sort of thing a person logs without saying which meal it belonged to. */
const UNSLOTTED: readonly SeedFood[] = [
  {
    id: 'dark-chocolate',
    name: 'Dark chocolate, 85%',
    macrosPer100g: { carbs: 22, fiber: 12, sugars: 8.5, polyols: 0, protein: 10, fat: 46, kcal: 530 },
    curated: true,
  },
  {
    id: 'green-olives',
    name: 'Green olives',
    macrosPer100g: { carbs: 3.8, fiber: 3.3, sugars: 0.5, polyols: 0, protein: 1, fat: 15.3, kcal: 145 },
    curated: false,
  },
];

/**
 * THE ANCHORS: carbohydrate-dense foods whose portion is SOLVED rather than
 * chosen, so the day lands on the net-carb figure its carb level asks for.
 *
 * Every one of them is well above 10 g net carbs per 100 g, which keeps the
 * solved portion in a range a person would recognise. An anchor at 2 g per
 * 100 g would need a kilogram of it to move a day over the ceiling.
 */
const ANCHORS: readonly SeedFood[] = [
  {
    id: 'white-rice',
    name: 'Cooked white rice',
    macrosPer100g: { carbs: 28.2, fiber: 0.4, sugars: 0.1, polyols: 0, protein: 2.7, fat: 0.3, kcal: 130 },
    curated: true,
  },
  {
    id: 'wholemeal-bread',
    name: 'Wholemeal bread',
    macrosPer100g: { carbs: 41, fiber: 6.5, sugars: 4.3, polyols: 0, protein: 9.7, fat: 3.4, kcal: 247 },
    curated: true,
  },
  {
    id: 'boiled-potatoes',
    name: 'Boiled potatoes',
    macrosPer100g: { carbs: 17, fiber: 1.8, sugars: 0.9, polyols: 0, protein: 2, fat: 0.1, kcal: 77 },
    curated: false,
  },
  {
    id: 'banana',
    name: 'Banana',
    macrosPer100g: { carbs: 22.8, fiber: 2.6, sugars: 12.2, polyols: 0, protein: 1.1, fat: 0.3, kcal: 89 },
    curated: true,
  },
];

/** Every food the generator can reach. One personal-food row is written per entry, so /add's "Your foods" list is populated. */
const SEED_CATALOG: readonly SeedFood[] = [
  ...BREAKFASTS,
  ...PROTEINS,
  ...VEGETABLES,
  ...SNACKS,
  ...UNSLOTTED,
  ...ANCHORS,
];

/** What the caller asks for. Everything has a default. */
export interface SeedDiaryOptions {
  /** How many whole weeks of diary, ending on `endDay`. */
  weeks: number;
  /** The PRNG seed. The same string always picks the same foods for the same days. */
  seed: string;
  /** The last, most recent day of the diary as `YYYY-MM-DD`. Defaults to today in `timezone`. */
  endDay?: string;
  /** IANA zone. Every clock time below is a LOCAL time in this zone; the stored instants are derived from it. */
  timezone: string;
}

/** What the generator built, for the operator to read back and for a test to assert on. */
export interface SeedDiarySummary {
  firstDay: string;
  lastDay: string;
  /** Calendar days covered, `weeks * 7`. */
  dayCount: number;
  /** Days with no entries at all. Never zero for a diary of a week or more. */
  emptyDayCount: number;
  foodLogCount: number;
  personalFoodCount: number;
  weightEntryCount: number;
  /** Net carbs per day, oldest first. An empty day is `0`, and `emptyDayCount` is what tells the two apart. */
  netCarbsByDay: readonly number[];
}

/** How many days a week is. Named because it is arithmetic, not a magic 7. */
const DAYS_PER_WEEK = 7;

/** The upper bound on `weeks`. A year of seeded diary is already far past what any review needs. */
export const MAX_SEED_WEEKS = 52;

/** Local clock times each slot is logged at, in `timezone`. */
const SLOT_HOUR = {
  breakfast: 8,
  lunch: 12,
  dinner: 19,
  snack: 16,
  unslotted: 21,
} satisfies Record<SeedSlot, number>;

const SLOT_MINUTE = {
  breakfast: 5,
  lunch: 40,
  dinner: 15,
  snack: 30,
  unslotted: 50,
} satisfies Record<SeedSlot, number>;

/** The five places an entry can sit in a seeded day. `unslotted` is the one that is NOT a `MealType`. */
type SeedSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unslotted';

/** The meal a slot maps to, or `null` for the deliberately unslotted one. */
const SLOT_MEAL = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'snack',
  unslotted: null,
} satisfies Record<SeedSlot, MealType | null>;

/**
 * A 32-bit mixing PRNG (mulberry32), seeded from a string.
 *
 * Rolled here rather than taken from a dependency because the property that
 * matters is REPRODUCIBILITY ACROSS RUNS, and a dependency that changes its
 * algorithm in a patch release would silently invalidate every screenshot
 * baseline. Fifteen lines that cannot change is the cheaper guarantee. It is
 * decidedly not a cryptographic generator and nothing here needs one.
 */
function createRng(seed: string): () => number {
  // FNV-1a over the seed string, so two different seeds start far apart.
  let state = 0x811c9dc5;
  // `codePointAt(0)` is only `undefined` for an empty string, which iterating
  // a string can never yield; the fallback keeps the arithmetic total anyway.
  for (const char of seed) {
    state = Math.imul(state ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks one item. Never empty by construction — every catalogue array above has at least two entries. */
function pick<TItem>(rng: () => number, items: readonly TItem[]): TItem {
  const chosen = items[Math.floor(rng() * items.length)];
  if (chosen === undefined) throw new Error('Cannot pick from an empty catalogue');
  return chosen;
}

/** One decimal, which is what the app itself displays, so what is stored is what a reader will see. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function scaleToServing(per100g: Macros, grams: number): Macros {
  const scale = (value: number | null): number | null => (value === null ? null : round1((value * grams) / 100));
  return {
    carbs: scale(per100g.carbs),
    fiber: scale(per100g.fiber),
    sugars: scale(per100g.sugars),
    polyols: scale(per100g.polyols),
    protein: scale(per100g.protein),
    fat: scale(per100g.fat),
    kcal: scale(per100g.kcal),
  };
}

/** Net carbs per 100 g for a catalogue food. `computeNetCarbsFromParts` is the app's own formula, not a second copy of it. */
function netCarbsPer100g(food: SeedFood): number {
  const net = computeNetCarbsFromParts(food.macrosPer100g);
  if (net === null) throw new Error(`Seed food ${food.id} has no carbohydrate figure`);
  return net;
}

/** One planned entry, before it becomes a `LocalFoodLog`. */
interface PlannedEntry {
  slot: SeedSlot;
  food: SeedFood;
  grams: number;
}

/**
 * Solves the anchor portion that carries the day from `baseNetCarbs` to
 * `targetNetCarbs`.
 *
 * This is the whole reason the day totals are trustworthy: the other portions
 * are picked, so their contribution is whatever it is, and one portion is then
 * computed to close the gap. Rounded to a whole gram, which moves the day by
 * at most a third of a gram, far inside the bands the carb levels are checked
 * against.
 *
 * A floor of 10 g rather than 0: the anchor is the day's visible carbohydrate
 * and a 1 g portion of rice reads as a bug. The floor can only bind if the
 * picked portions already overshoot the target, which the catalogue's low-carb
 * bias makes unreachable today; it is here so a future edit to the catalogue
 * degrades into "slightly over" instead of into a negative portion.
 */
export function solveAnchorGrams({
  baseNetCarbs,
  targetNetCarbs,
  anchorNetCarbsPer100g,
}: {
  baseNetCarbs: number;
  targetNetCarbs: number;
  anchorNetCarbsPer100g: number;
}): number {
  if (anchorNetCarbsPer100g <= 0) throw new Error('An anchor food must carry net carbohydrate');
  const grams = Math.round(((targetNetCarbs - baseNetCarbs) / anchorNetCarbsPer100g) * 100);
  return Math.max(10, grams);
}

/**
 * Plans one day's entries.
 *
 * Which slots exist is a RULE on the day index rather than a dice roll, so it
 * can be read off this file instead of run: breakfast, lunch and dinner every
 * logged day; a snack every other day; an unslotted entry every fourth. That
 * spread is what puts something in all four meal slots and something in none
 * of them, which is what a reviewer of the diary screen needs to see.
 */
function planDay({
  rng,
  offsetFromEnd,
  carbLevel,
  ceilingG,
}: {
  rng: () => number;
  offsetFromEnd: number;
  carbLevel: SeedDayCarbLevel;
  ceilingG: number;
}): PlannedEntry[] {
  if (carbLevel === 'empty') return [];

  const planned: PlannedEntry[] = [
    { slot: 'breakfast', food: pick(rng, BREAKFASTS), grams: 110 + Math.round(rng() * 6) * 10 },
    { slot: 'lunch', food: pick(rng, PROTEINS), grams: 130 + Math.round(rng() * 5) * 10 },
    { slot: 'lunch', food: pick(rng, VEGETABLES), grams: 70 + Math.round(rng() * 6) * 10 },
    { slot: 'dinner', food: pick(rng, PROTEINS), grams: 140 + Math.round(rng() * 5) * 10 },
    { slot: 'dinner', food: pick(rng, VEGETABLES), grams: 90 + Math.round(rng() * 7) * 10 },
  ];
  if (offsetFromEnd % 2 === 0)
    planned.push({ slot: 'snack', food: pick(rng, SNACKS), grams: 20 + Math.round(rng() * 2) * 10 });
  if (offsetFromEnd % 4 === 2)
    planned.push({ slot: 'unslotted', food: pick(rng, UNSLOTTED), grams: 20 + Math.round(rng() * 2) * 10 });

  const baseNetCarbs = planned.reduce((total, entry) => total + (netCarbsPer100g(entry.food) * entry.grams) / 100, 0);
  const anchor = pick(rng, ANCHORS);
  planned.push({
    // Lunch on even days, dinner on odd ones, so the carbohydrate is not
    // always in the same row of every screenshot.
    slot: offsetFromEnd % 2 === 0 ? 'lunch' : 'dinner',
    food: anchor,
    grams: solveAnchorGrams({
      baseNetCarbs,
      targetNetCarbs: ceilingG * CARB_LEVEL_TARGET_FRACTION[carbLevel],
      anchorNetCarbsPer100g: netCarbsPer100g(anchor),
    }),
  });
  return planned;
}

/**
 * Whether an entry is a photographed plate rather than a typed one.
 *
 * A rule, not a dice roll, for the same reason the slots are: a reviewer
 * looking for the AI-estimate badge should be able to work out from this file
 * which rows carry it. Roughly half the dinners, which is a believable mix and
 * enough that the badge appears on the first screen anybody opens.
 */
function isPhotographed({ slot, offsetFromEnd }: { slot: SeedSlot; offsetFromEnd: number }): boolean {
  return slot === 'dinner' && offsetFromEnd % 2 === 0;
}

/** Turns one planned entry into the stored row. */
function toFoodLog({
  planned,
  dayKey,
  offsetFromEnd,
  loggedAt,
  index,
}: {
  planned: PlannedEntry;
  dayKey: string;
  offsetFromEnd: number;
  loggedAt: number;
  index: number;
}): LocalFoodLog {
  const photographed = isPhotographed({ slot: planned.slot, offsetFromEnd });
  // A photographed plate is an estimate with no database behind it, so it
  // carries no provenance whatever the catalogue says about the food.
  const fromDatabase = planned.food.curated && !photographed;
  const log: LocalFoodLog = {
    id: `seed-log-${dayKey}-${index}-${planned.food.id}`,
    name: planned.food.name,
    quantityGrams: planned.grams,
    macros: scaleToServing(planned.food.macrosPer100g, planned.grams),
    mealType: SLOT_MEAL[planned.slot],
    source: photographed ? 'plate_ai' : 'manual',
    aiEstimated: photographed,
    curatedSource: fromDatabase ? SEED_CURATED_SOURCE : null,
    foodId: `seed-food-${planned.food.id}`,
    dayKey,
    loggedAt,
    createdAt: loggedAt,
    logBatchId: null,
  };
  // WRITTEN ONLY WHEN THERE IS SOMETHING TO WRITE, and never as `null`.
  // `attribution` and `netCarbsPer100g` are THREE-state fields (`schema.ts`):
  // ABSENT is "no upstream source was ever consulted", `null` is "one was, and
  // it had no answer". A typed entry is the first of those, so a fixture that
  // wrote `null` would misrepresent the very distinction the readers branch on.
  if (fromDatabase) {
    log.attribution = SEED_ATTRIBUTION;
    log.netCarbsPer100g = round1(netCarbsPer100g(planned.food));
  }
  return log;
}

/** The personal-food rows, one per catalogue entry, so /add's "Your foods" list is not empty. */
function buildPersonalFoods(createdAt: number): LocalPersonalFood[] {
  return SEED_CATALOG.map((food) => {
    const personal: LocalPersonalFood = {
      id: `seed-food-${food.id}`,
      name: food.name,
      brand: null,
      macrosPer100g: food.macrosPer100g,
      source: 'user',
      createdAt,
    };
    // Absent rather than `null` for the hand-typed half, for the reason spelled
    // out in {@link toFoodLog}.
    if (food.curated) personal.netCarbsPer100g = round1(netCarbsPer100g(food));
    return personal;
  });
}

/**
 * The weight series: every third day, drifting down towards the target with a
 * small deterministic wobble.
 *
 * Every third rather than every day because that is what people actually do,
 * and because a chart of a gappy series is the harder one to get right.
 */
function buildWeightEntries({
  rng,
  days,
  timezone,
}: {
  rng: () => number;
  days: readonly SeedDay[];
  timezone: string;
}): LocalWeightEntry[] {
  const startWeightKg = 84;
  const kgPerDay = 0.06;
  return days
    .filter((day) => day.offsetFromEnd % 3 === 0)
    .map((day) => {
      const weightKg = round1(startWeightKg - kgPerDay * (days.length - 1 - day.offsetFromEnd) + (rng() - 0.5) * 0.7);
      const loggedAt = dayBoundsInTimezone(day.dayKey, timezone).start.getTime() + 7 * 3600_000;
      return {
        id: `seed-weight-${day.dayKey}`,
        dayKey: day.dayKey,
        weightKg,
        loggedAt,
        createdAt: loggedAt,
      };
    });
}

/** One calendar day of the diary, with its distance from the end already worked out. */
interface SeedDay {
  dayKey: string;
  offsetFromEnd: number;
  carbLevel: SeedDayCarbLevel;
}

/** The calendar days, oldest first. */
function buildDays({ weeks, endDay }: { weeks: number; endDay: string }): SeedDay[] {
  const dayCount = weeks * DAYS_PER_WEEK;
  const days: SeedDay[] = [];
  for (let offsetFromEnd = dayCount - 1; offsetFromEnd >= 0; offsetFromEnd -= 1) {
    days.push({
      dayKey: shiftDate(endDay, -offsetFromEnd),
      offsetFromEnd,
      carbLevel: seedDayCarbLevel(offsetFromEnd),
    });
  }
  return days;
}

/**
 * Builds the whole restorable backup envelope.
 *
 * `schemaVersion` is the app's own `SCHEMA_VERSION` rather than a literal, so
 * a schema bump either keeps working or fails loudly here instead of producing
 * an envelope the importer quietly migrates.
 *
 * `onboardingCompletedAt` is stamped, and it is that field which carries a
 * restored device past the onboarding gate. Without it every navigation lands
 * on the welcome wizard and the seeded diary is unreachable.
 */
export function buildSeedDiary(options: SeedDiaryOptions): BackupEnvelope {
  if (!Number.isInteger(options.weeks) || options.weeks < 1 || options.weeks > MAX_SEED_WEEKS) {
    throw new Error(`weeks must be a whole number between 1 and ${MAX_SEED_WEEKS}, got ${options.weeks}`);
  }
  const endDay = options.endDay ?? todayInTimezone(options.timezone);
  const days = buildDays({ weeks: options.weeks, endDay });
  const rng = createRng(options.seed);

  // A day before the oldest entry: every personal food and the profile itself
  // must predate the logs that point at them, or the diary shows entries
  // created before the foods they were logged from.
  const firstDay = days[0];
  if (firstDay === undefined) throw new Error('A diary needs at least one day');
  const originAt = dayBoundsInTimezone(shiftDate(firstDay.dayKey, -1), options.timezone).start.getTime();

  const foodLogs: LocalFoodLog[] = [];
  for (const day of days) {
    const dayStart = dayBoundsInTimezone(day.dayKey, options.timezone).start.getTime();
    const planned = planDay({
      rng,
      offsetFromEnd: day.offsetFromEnd,
      carbLevel: day.carbLevel,
      ceilingG: SEED_GOALS.goalNetCarbsCeilingG,
    });
    planned.forEach((entry, index) => {
      const loggedAt = dayStart + SLOT_HOUR[entry.slot] * 3600_000 + SLOT_MINUTE[entry.slot] * 60_000;
      foodLogs.push(
        toFoodLog({ planned: entry, dayKey: day.dayKey, offsetFromEnd: day.offsetFromEnd, loggedAt, index }),
      );
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(originAt).toISOString(),
    data: {
      foods: buildPersonalFoods(originAt),
      foodLogs,
      weightEntries: buildWeightEntries({ rng, days, timezone: options.timezone }),
      profile: {
        timezone: options.timezone,
        goalNetCarbsCeilingG: SEED_GOALS.goalNetCarbsCeilingG,
        goalProteinFloorG: SEED_GOALS.goalProteinFloorG,
        goalKcalTarget: SEED_GOALS.goalKcalTarget,
        targetWeightKg: SEED_GOALS.targetWeightKg,
        // Derived by the app's own rule from the goals above: a ceiling is set,
        // so the focus is net carbs. Never typed independently of the goals.
        trackingFocus: 'net-carbs',
        onboardingCompletedAt: originAt,
        updatedAt: originAt,
      },
      fasts: [],
      savedMeals: [],
      shareIdentity: null,
      sharePeers: [],
      researchIdentity: null,
      studyEnrolments: [],
    },
  };
}

/**
 * Reads back what an envelope contains, from the envelope itself rather than
 * from the options that produced it.
 *
 * Deliberately a second pass over the output: a summary computed from the
 * inputs would agree with the generator by construction and would report a
 * missing day as present. This one counts rows.
 */
export function summarizeSeedDiary(envelope: BackupEnvelope): SeedDiarySummary {
  const dayKeys = [...new Set(envelope.data.foodLogs.map((log) => log.dayKey))].toSorted();
  const netCarbsByDayKey = new Map<string, number>();
  for (const log of envelope.data.foodLogs) {
    const perServing = computeNetCarbsFromParts(log.macros);
    netCarbsByDayKey.set(log.dayKey, (netCarbsByDayKey.get(log.dayKey) ?? 0) + (perServing ?? 0));
  }

  const firstLoggedDay = dayKeys[0];
  const lastLoggedDay = dayKeys[dayKeys.length - 1];
  if (firstLoggedDay === undefined || lastLoggedDay === undefined) {
    throw new Error('A seeded diary must carry at least one logged day');
  }
  // The calendar span, which is what "how many days" means here — the LOGGED
  // days are a subset of it, and the difference is the whole point.
  const spanDays = allDaysBetween(firstLoggedDay, lastLoggedDay);
  return {
    firstDay: firstLoggedDay,
    lastDay: lastLoggedDay,
    dayCount: spanDays.length,
    emptyDayCount: spanDays.filter((dayKey) => !netCarbsByDayKey.has(dayKey)).length,
    foodLogCount: envelope.data.foodLogs.length,
    personalFoodCount: envelope.data.foods.length,
    weightEntryCount: envelope.data.weightEntries.length,
    netCarbsByDay: spanDays.map((dayKey) => round1(netCarbsByDayKey.get(dayKey) ?? 0)),
  };
}

/** Every calendar day from `from` to `to` inclusive, oldest first. Bounded by the span it is given. */
function allDaysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  for (let step = 0; step <= MAX_SEED_WEEKS * DAYS_PER_WEEK && cursor <= to; step += 1) {
    days.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return days;
}
