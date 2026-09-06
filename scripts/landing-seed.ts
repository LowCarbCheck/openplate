/**
 * The committed, fixed example diary that every landing screenshot shows.
 *
 * One day, six meals, 41.2 g net carbs. See `SEED_MEALS` for the table and
 * the half-the-ceiling rule that governs it, and `SEED_DAY_PARTS` for why there
 * is no history.
 *
 * ── Why a file, and not a fixture generator ──────────────────────────────
 *
 * Two captures of the same locale must differ only by a real UI change. A
 * randomised or clock-derived seed would move a number, a time or a day label
 * on every run, and then every re-capture produces a diff nobody can read: the
 * reviewer cannot tell the ring moved because a component changed from the
 * ring moving because the dice did. So the data is a literal table, the clock
 * is frozen (see `SEED_INSTANT`), and the day keys are hard-coded. It is also
 * a table on purpose rather than an object graph: a person has to be able to
 * open this file, read the meals as rows, and edit one.
 *
 * ── What may go in it ────────────────────────────────────────────────────
 *
 * Obviously example data, ordinary foods, nothing else. No weight entries, no
 * height, no birth year, no biological sex, no reproductive status, no notes.
 * The screenshots are published on a public marketing page, and a diary that
 * reads like a real person's is both a privacy smell and a medical claim the
 * page is not making. The names are per language so the German captures show
 * German food names, which is the whole reason the capture takes a locale.
 */
import { SCHEMA_VERSION } from '../app/lib/local-store/schema';
import type { BackupEnvelope } from '../app/lib/local-store/backup';
import type { LocalFoodLog, LocalPersonalFood } from '../app/lib/local-store/schema';
import type { Macros } from '../app/lib/macros';
import type { LanguageCode } from '../app/i18n/language-prefs';
import type { MealType } from '../types/enums';

/**
 * The zone the capture emulates (`Emulation.setTimezoneOverride`). Every local
 * clock time in the table below is read in this zone, and the UTC instants are
 * derived from it, so the times printed in a screenshot equal the times here.
 */
export const SEED_TIMEZONE = 'Europe/Berlin';

/**
 * The instant the browser clock is frozen at: Thursday 14 May 2026, 21:40
 * Europe/Berlin (summer time, UTC+2). Late enough in the evening that the whole
 * day's meals are already logged, so the captured diary is a full day rather
 * than a morning. Freezing it is what makes the diary header read the same date
 * on every run, forever.
 */
export const SEED_INSTANT = Date.UTC(2026, 4, 14, 19, 40);

/** The day every screenshot is taken on: the last and fullest day of the seed. */
export const SEED_DAY = '2026-05-14';

/**
 * Europe/Berlin is UTC+2 across the whole seeded week (summer time), so a local
 * clock time is its UTC hour plus two. Subtracting it here is what keeps the
 * times rendered in the screenshots equal to the `hourLocal` column.
 */
const BERLIN_UTC_OFFSET_HOURS = 2;

/**
 * ONE day, the captured one. There is deliberately NO history, and this is the
 * thing in the file most likely to be helpfully added back.
 *
 * A populated yesterday changes the diary screen: it grows a "quick add" chip
 * row and a "copy from yesterday" row above the meal list, and on a 390 px
 * viewport those two sections push every food entry below the fold. The shot
 * then reads as a ring followed by two rows of chips, with not one meal
 * visible, which is the opposite of what a diary screenshot is for.
 *
 * Nothing is lost by it. With a single day the "logged N of the last 7 days"
 * dots read "1 of the last 7 days", which is exactly what they read in the
 * hand-made shots this set replaces.
 *
 * Spelled out as fields rather than parsed out of the key so the key and the
 * arithmetic cannot drift apart.
 */
const SEED_DAY_PARTS = { key: SEED_DAY, year: 2026, monthIndex: 4, day: 14 };

/**
 * A fixed instant before the seeded day (1 May 2026, 09:00 UTC), used as
 * `createdAt` for every personal food and as the profile's stamps. It has to
 * predate the logs or the diary would show entries created before the foods
 * they point at.
 */
const SEED_ORIGIN_INSTANT = Date.UTC(2026, 4, 1, 9, 0);

/**
 * Truthy so the diary renders its own localized "from our food database" chip
 * on every row (see `ProvenanceBadge` in `app/routes/diary.tsx`). The VALUE is
 * never displayed anywhere, only its truthiness is read, so this string is a
 * marker and not copy. It is set at all because a diary with no provenance
 * chips looks like a diary of hand-typed guesses, which is not the product.
 */
const SEED_CURATED_SOURCE = 'landing-seed';

type SeedMeal = {
  /** Stable, readable id fragment. Appears in every generated row id. */
  id: string;
  names: Record<LanguageCode, string>;
  meal: MealType;
  hourLocal: number;
  minuteLocal: number;
  grams: number;
  /**
   * PER 100 G, deliberately: that is the basis a reader can sanity check
   * against a package, and the basis the /add screen's recent list shows. The
   * absolute per-serving macros on each log are derived from it and `grams`.
   *
   * Total-carbohydrate convention (fibre INCLUDED in `carbs`), which is what
   * the app assumes when a food carries no explicit basis, so net carbs come
   * out as `carbs - fiber` on every row.
   */
  macrosPer100g: Macros;
};

/**
 * The day, as a table. It totals 41.2 g net carbs, 1606 kcal and 113.4 g
 * protein against the 100 g ceiling, 2000 kcal target and 90 g protein floor in
 * `buildLandingSeed` below.
 *
 * THE RULE, and it has a visible consequence: the day must stay at or under
 * HALF the net-carb ceiling, so 50 g here. `computeCarbImpact` in
 * `app/lib/macro-gaps.ts` reads `LOW_IMPACT_MAX_FRACTION = 0.5`, and a day
 * above it turns the impact chip from the teal "low" to the amber "moderate"
 * in every shot that renders it. Enlarging a portion or adding a row is
 * therefore a design change, not a data change. 41.2 g, which is 0.41 of the ceiling, leaves real headroom
 * without the suspiciously perfect look of a 10 g day.
 */
const SEED_MEALS: readonly SeedMeal[] = [
  {
    id: 'porridge',
    names: { en: 'Porridge with berries', de: 'Porridge mit Beeren' },
    meal: 'breakfast',
    hourLocal: 8,
    minuteLocal: 5,
    grams: 150,
    macrosPer100g: { carbs: 11, fiber: 1.6, sugars: 3.2, polyols: 0, protein: 2.8, fat: 1.9, kcal: 79 },
  },
  {
    id: 'yoghurt',
    names: { en: 'Greek yoghurt with walnuts', de: 'Griechischer Joghurt mit Walnüssen' },
    meal: 'snack',
    hourLocal: 10,
    minuteLocal: 30,
    grams: 150,
    macrosPer100g: { carbs: 4.2, fiber: 0.6, sugars: 3.8, polyols: 0, protein: 7.5, fat: 9, kcal: 132 },
  },
  {
    id: 'chicken-salad',
    names: { en: 'Chicken salad with olive oil', de: 'Hähnchensalat mit Olivenöl' },
    meal: 'lunch',
    hourLocal: 12,
    minuteLocal: 45,
    grams: 320,
    macrosPer100g: { carbs: 3.6, fiber: 1.4, sugars: 1.8, polyols: 0, protein: 12, fat: 7.5, kcal: 128 },
  },
  {
    id: 'almonds',
    names: { en: 'Almonds', de: 'Mandeln' },
    meal: 'snack',
    hourLocal: 16,
    minuteLocal: 40,
    grams: 40,
    macrosPer100g: { carbs: 21.6, fiber: 12.5, sugars: 4.4, polyols: 0, protein: 21.2, fat: 49.4, kcal: 579 },
  },
  {
    id: 'salmon',
    names: { en: 'Salmon with roasted vegetables', de: 'Lachs mit Ofengemüse' },
    meal: 'dinner',
    hourLocal: 19,
    minuteLocal: 15,
    grams: 350,
    macrosPer100g: { carbs: 4.4, fiber: 1.8, sugars: 2.1, polyols: 0, protein: 14, fat: 8.6, kcal: 155 },
  },
  {
    id: 'dark-chocolate',
    names: { en: 'Dark chocolate, 85%', de: 'Zartbitterschokolade, 85%' },
    meal: 'snack',
    hourLocal: 20,
    minuteLocal: 30,
    grams: 20,
    macrosPer100g: { carbs: 22, fiber: 12, sugars: 8.5, polyols: 0, protein: 10, fat: 46, kcal: 530 },
  },
];

/** One decimal is what the app itself displays, so store what a reader will see. */
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

function foodId(meal: SeedMeal): string {
  return `seed-food-${meal.id}`;
}

function buildFoods(language: LanguageCode): LocalPersonalFood[] {
  return SEED_MEALS.map((meal) => ({
    id: foodId(meal),
    name: meal.names[language],
    brand: null,
    macrosPer100g: meal.macrosPer100g,
    source: 'user',
    createdAt: SEED_ORIGIN_INSTANT,
  }));
}

function buildFoodLogs(language: LanguageCode): LocalFoodLog[] {
  return SEED_MEALS.map((meal): LocalFoodLog => {
    const loggedAt = Date.UTC(
      SEED_DAY_PARTS.year,
      SEED_DAY_PARTS.monthIndex,
      SEED_DAY_PARTS.day,
      meal.hourLocal - BERLIN_UTC_OFFSET_HOURS,
      meal.minuteLocal,
    );
    return {
      id: `seed-log-${SEED_DAY_PARTS.key}-${meal.id}`,
      name: meal.names[language],
      quantityGrams: meal.grams,
      macros: scaleToServing(meal.macrosPer100g, meal.grams),
      mealType: meal.meal,
      source: 'manual',
      aiEstimated: false,
      curatedSource: SEED_CURATED_SOURCE,
      foodId: foodId(meal),
      dayKey: SEED_DAY_PARTS.key,
      loggedAt,
      createdAt: loggedAt,
      logBatchId: null,
    };
  });
}

/**
 * Build the envelope for one locale.
 *
 * `schemaVersion` is the app's own `SCHEMA_VERSION` rather than a literal, so a
 * schema bump either keeps working or breaks here loudly instead of producing
 * an envelope the importer quietly migrates.
 *
 * `onboardingCompletedAt` is stamped, and that is the field that carries the
 * capture past `_personal.tsx`'s onboarding gate. Without it every navigation
 * lands on the welcome wizard and every screenshot is of the wizard.
 */
export function buildLandingSeed(language: LanguageCode): BackupEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(SEED_ORIGIN_INSTANT).toISOString(),
    data: {
      foods: buildFoods(language),
      foodLogs: buildFoodLogs(language),
      weightEntries: [],
      profile: {
        timezone: SEED_TIMEZONE,
        goalNetCarbsCeilingG: 100,
        goalProteinFloorG: 90,
        goalKcalTarget: 2000,
        targetWeightKg: null,
        trackingFocus: 'net-carbs',
        onboardingCompletedAt: SEED_ORIGIN_INSTANT,
        updatedAt: SEED_ORIGIN_INSTANT,
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
