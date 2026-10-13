/**
 * Logs, reference amounts and body facts for the vitamins and minerals cards.
 *
 * A scenario is the INPUT the block is built from, never a finished snapshot:
 * food logs, the days to read, the reference list and the saved profile. The
 * section runs every scenario through the app's own pipeline
 * (`computeMicronutrientsInWindow`, `buildNutrientRows`,
 * `buildMicronutrientSnapshot`), so a gap, a share and a count on a card are
 * the app's own arithmetic.
 *
 * ALL FIGURES HERE ARE FIXTURES. The reference amounts are round numbers of a
 * plausible size, written for this page, and the foods carry whatever per-100 g
 * figure lands a nutrient at the share a card wants to show. None of them is
 * copied from LowCarbCheck, from BLS, or from any published table.
 */
import { DISPLAYED_NUTRIENT_KEYS, NUTRIENT_UNITS } from '#app/lib/nutrient-reference';
import type { NutrientReference } from '#app/lib/nutrient-reference';
import { MINERAL_KEYS, VITAMIN_KEYS } from '#app/lib/micronutrients';
import type { MicronutrientsPer100g, MineralKey, NutrientKey, VitaminKey } from '#app/lib/micronutrients';
import type { LocalFoodLog } from '#app/lib/local-store/schema';
import { EMPTY_BODY_METRICS, RDA_AGE_BANDS } from '#app/models/body-metrics';
import type { BodyMetrics } from '#app/models/body-metrics';
import { shiftDate } from '#app/lib/user-days';
import { dayKeyOf, PLAYGROUND_NOW } from './clock';

/** The playground's today, as a day key. */
export const NUTRIENT_TODAY = dayKeyOf(PLAYGROUND_NOW);

/** The person's calendar year, read off the same clock. */
export const NUTRIENT_CURRENT_YEAR = PLAYGROUND_NOW.getUTCFullYear();

/** A saved profile with both facts a reference amount is looked up by. */
export const ADULT_METRICS: BodyMetrics = { ...EMPTY_BODY_METRICS, biologicalSex: 'female', birthYear: 1988 };

/** A saved profile with neither fact. */
export const NO_METRICS: BodyMetrics = EMPTY_BODY_METRICS;

/** A fixture reference amount per nutrient, in that nutrient's own unit. Sodium is the one limit. */
const FIXTURE_AMOUNTS = {
  betaCarotene: 2000,
  vitaminA: 800,
  vitaminC: 100,
  vitaminD: 20,
  vitaminE: 12,
  vitaminB1: 1,
  vitaminB2: 1.2,
  vitaminB6: 1.4,
  vitaminB9: 300,
  vitaminB12: 4,
  nacl: 5000,
  potassium: 4000,
  sodium: 2000,
  calcium: 1000,
  magnesium: 300,
  zinc: 8,
  phosphorus: 700,
  iron: 15,
} as const satisfies Readonly<Record<NutrientKey, number>>;

/** The fixture source line every reference carries. */
const FIXTURE_SOURCE = 'Playground fixture, not a published table';

/** One fixture reference, the same amount in every band, for both sexes. */
function fixtureReference(key: NutrientKey): NutrientReference {
  const amount = FIXTURE_AMOUNTS[key];
  const bands = Object.fromEntries(RDA_AGE_BANDS.map((band) => [band, amount]));
  // SAFETY: `RDA_AGE_BANDS` is every band, so the object has one entry per band.
  const perBand = bands as Record<(typeof RDA_AGE_BANDS)[number], number>;
  return {
    key,
    slug: key,
    unit: NUTRIENT_UNITS[key],
    kind: key === 'sodium' ? 'ceiling' : 'target',
    rda: { source: FIXTURE_SOURCE, male: perBand, female: perBand, pregnancy: null, lactation: null },
  };
}

/** The reference list as the instance would answer it, with fixture amounts. */
export const FIXTURE_REFERENCES: readonly NutrientReference[] = DISPLAYED_NUTRIENT_KEYS.map(fixtureReference);

/** The reference list as an unreachable food database answers it. */
export const UNREACHABLE_REFERENCES: readonly NutrientReference[] = [];

/** Every displayed nutrient at 1.5 times its reference, so it is never a gap; sodium well under its limit. */
const COMFORTABLE_SHARE = 1.5;
const SODIUM_COMFORTABLE_SHARE = 0.4;

/**
 * A per-100 g block that puts each nutrient at a share of its fixture
 * reference once `grams` of the food are eaten on one day.
 *
 * @param input.grams - how much of the food is logged.
 * @param input.shares - the shares to land, per nutrient. The rest sit comfortably above.
 */
function blockAtShares({
  grams,
  shares,
}: {
  grams: number;
  shares: Partial<Record<NutrientKey, number>>;
}): MicronutrientsPer100g {
  const per100g = (key: NutrientKey): number => {
    const fallback = key === 'sodium' ? SODIUM_COMFORTABLE_SHARE : COMFORTABLE_SHARE;
    return ((shares[key] ?? fallback) * FIXTURE_AMOUNTS[key] * 100) / grams;
  };
  // SAFETY: each `Object.fromEntries` maps exactly the keys of its block to a number.
  const vitamins = Object.fromEntries(VITAMIN_KEYS.map((key) => [key, per100g(key)])) as Record<VitaminKey, number>;
  // SAFETY: as above, for the mineral keys.
  const minerals = Object.fromEntries(MINERAL_KEYS.map((key) => [key, per100g(key)])) as Record<MineralKey, number>;
  return { vitamins, minerals };
}

/** One logged food. With no block it is an AI estimate, which carries no vitamin or mineral figures. */
function fixtureLog({
  id,
  name,
  day,
  grams,
  block,
}: {
  id: string;
  name: string;
  day: string;
  grams: number;
  block?: MicronutrientsPer100g;
}): LocalFoodLog {
  const loggedAt = Date.parse(`${day}T12:00:00Z`);
  const isEstimate = block === undefined;
  const log: LocalFoodLog = {
    id,
    name,
    quantityGrams: grams,
    macros: { carbs: 6, fiber: 2, sugars: 2, polyols: null, protein: 9, fat: 7, kcal: 125 },
    mealType: 'lunch',
    source: isEstimate ? 'plate_ai' : 'manual',
    aiEstimated: isEstimate,
    curatedSource: isEstimate ? null : 'playground-fixture',
    foodId: null,
    dayKey: day,
    loggedAt,
    createdAt: loggedAt,
    logBatchId: null,
  };
  if (!isEstimate) log.micronutrientsPer100g = block;
  return log;
}

/** What a card is built from. */
export interface NutrientScenario {
  logs: readonly LocalFoodLog[];
  fromDate: string;
  toDate: string;
  references: readonly NutrientReference[];
  metrics: BodyMetrics;
}

/** One day, today, with the fixture references and an adult profile, unless told otherwise. */
function todayScenario(
  logs: readonly LocalFoodLog[],
  overrides: Partial<Pick<NutrientScenario, 'references' | 'metrics'>> = {},
): NutrientScenario {
  return {
    logs,
    fromDate: NUTRIENT_TODAY,
    toDate: NUTRIENT_TODAY,
    references: FIXTURE_REFERENCES,
    metrics: ADULT_METRICS,
    ...overrides,
  };
}

const SALMON_GRAMS = 250;

/** A covered lunch light on magnesium, vitamin D and zinc. */
const THREE_GAPS_LUNCH = fixtureLog({
  id: 'fixture-salmon-bowl',
  name: 'Salmon bowl (fixture)',
  day: NUTRIENT_TODAY,
  grams: SALMON_GRAMS,
  block: blockAtShares({ grams: SALMON_GRAMS, shares: { magnesium: 0.32, vitaminD: 0.45, zinc: 0.61 } }),
});

/** Good coverage, three nutrients under the suggestion ceiling. */
export const THREE_GAPS: NutrientScenario = todayScenario([THREE_GAPS_LUNCH]);

/** Every nutrient comfortably above its reference. */
export const NO_GAPS: NutrientScenario = todayScenario([
  fixtureLog({
    id: 'fixture-omelette',
    name: 'Spinach omelette (fixture)',
    day: NUTRIENT_TODAY,
    grams: SALMON_GRAMS,
    block: blockAtShares({ grams: SALMON_GRAMS, shares: {} }),
  }),
]);

/** Sodium at about one and a half times its limit, and one gap. */
export const SODIUM_OVER: NutrientScenario = todayScenario([
  fixtureLog({
    id: 'fixture-ramen',
    name: 'Ramen with broth (fixture)',
    day: NUTRIENT_TODAY,
    grams: SALMON_GRAMS,
    block: blockAtShares({ grams: SALMON_GRAMS, shares: { sodium: 1.55, vitaminC: 0.2 } }),
  }),
]);

/** Two plates, both estimated by AI: logged, but with no vitamin or mineral figures. */
export const AI_ONLY: NutrientScenario = todayScenario([
  fixtureLog({ id: 'fixture-ai-plate-1', name: 'Pasta plate (AI estimate)', day: NUTRIENT_TODAY, grams: 380 }),
  fixtureLog({ id: 'fixture-ai-plate-2', name: 'Side salad (AI estimate)', day: NUTRIENT_TODAY, grams: 120 }),
]);

const MIXED_COVERED_GRAMS = 165;
const MIXED_ESTIMATED_GRAMS = 135;

/** 165 g with figures beside 135 g estimated by AI: 55 percent, just under the 60 percent bar. */
export const MIXED_JUST_UNDER: NutrientScenario = todayScenario([
  fixtureLog({
    id: 'fixture-yoghurt',
    name: 'Greek yoghurt (fixture)',
    day: NUTRIENT_TODAY,
    grams: MIXED_COVERED_GRAMS,
    block: blockAtShares({ grams: MIXED_COVERED_GRAMS, shares: {} }),
  }),
  fixtureLog({ id: 'fixture-ai-curry', name: 'Curry (AI estimate)', day: NUTRIENT_TODAY, grams: MIXED_ESTIMATED_GRAMS }),
]);

/** The three-gap day, with no year of birth and no sex saved. */
export const NO_BODY_METRICS: NutrientScenario = todayScenario([THREE_GAPS_LUNCH], { metrics: NO_METRICS });

/** The three-gap day, with the food database out of reach. */
export const REFERENCES_UNREACHABLE: NutrientScenario = todayScenario([THREE_GAPS_LUNCH], {
  references: UNREACHABLE_REFERENCES,
});

/** A profile whose year of birth is below the youngest published band. */
export const AGE_OUT_OF_BANDS: NutrientScenario = todayScenario([THREE_GAPS_LUNCH], {
  metrics: { ...ADULT_METRICS, birthYear: NUTRIENT_CURRENT_YEAR - 9 },
});

/** A day with nothing logged. */
export const EMPTY_DAY: NutrientScenario = todayScenario([]);

const WEEK_DAYS = 7;

/** Five of the last seven days logged, light on iron and folate on average. */
export const WEEK_RANGE: NutrientScenario = {
  logs: [0, 1, 2, 4, 5].map((back) =>
    fixtureLog({
      id: `fixture-week-${back}`,
      name: 'Chicken and greens (fixture)',
      day: shiftDate(NUTRIENT_TODAY, -back),
      grams: SALMON_GRAMS,
      block: blockAtShares({ grams: SALMON_GRAMS, shares: { iron: 0.38, vitaminB9: 0.66 } }),
    }),
  ),
  fromDate: shiftDate(NUTRIENT_TODAY, -(WEEK_DAYS - 1)),
  toDate: NUTRIENT_TODAY,
  references: FIXTURE_REFERENCES,
  metrics: ADULT_METRICS,
};
