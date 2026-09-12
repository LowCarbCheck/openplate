/**
 * THE MORNING CATCH-UP, as words.
 *
 * The server never writes notification text (M223's one principle), so the
 * device has to write it before the push arrives. This module is where the
 * words are decided, and it is pure: every input is explicit, the translator
 * comes in as a parameter, and there is no clock in here at all. A caller
 * supplies the day keys; this module never asks what day it is.
 *
 * ── The tone is the product ──────────────────────────────────────────────
 *
 * Three lines at most, and each one is a fact:
 *
 *  1. Yesterday, in one sentence. A day with entries reads its meals, its net
 *     carbs against the ceiling and its protein against the floor, with the
 *     goal halves dropped when the person set no goal. A day with no entries
 *     that a fast covered reads "Yesterday was a fasting day", never "0 meals":
 *     a fast day is not an empty day, and saying otherwise turns a thing
 *     somebody did on purpose into a gap in their record.
 *  2. What lies ahead, and only when there IS something: a fast running, a fast
 *     scheduled, or the routine's usual hour.
 *  3. At most one nudge, and only when the same floor came in under on at least
 *     two of the last three days. One sentence of fact, then one sentence
 *     naming three foods the person has actually eaten before that carry the
 *     nutrient. No verdict, no "should", no weight, and no exclamation mark.
 *     `tests/unit/catch-up-tone.test.ts` is the gate, and it is asserted on the
 *     German output too, because a translation can reintroduce a lecture the
 *     English source avoided.
 *
 * An empty yesterday carries no nudge. Somebody who logged nothing has not
 * told us anything to be factual about, and three days of silence read as a
 * deficiency is the exact lecture this module exists to avoid.
 */
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import type { Translate } from '#app/models/fasting';

/** Where the notification deep links, and where the same words are rendered in the app. */
export const CATCH_UP_URL = '/catch-up';

/**
 * The fiber reference the nudge grades against, in grams.
 *
 * Restated here rather than imported so this module carries no dependency on
 * the diary's gap machinery; it is the same Institute of Medicine figure
 * `DEFAULT_FIBER_REFERENCE_G` documents.
 */
export const CATCH_UP_FIBER_REFERENCE_G = 25;

/** How many of the last three days must have come in under a floor before it is worth a sentence. */
export const NUDGE_MINIMUM_DAYS = 2;

/** The longest notification body, in characters, before it is cut at a word boundary. */
export const CATCH_UP_BODY_MAX_LENGTH = 180;

/** How many foods a nudge names. Three is a choice, not a list. */
const NUDGE_FOOD_COUNT = 3;

/** One of the three days the catch-up reads. */
export interface CatchUpDay {
  /** Device-local `YYYY-MM-DD`. */
  dayKey: string;
  /** How many entries the day carries. `0` is an empty day. */
  meals: number;
  netCarbsG: number;
  proteinG: number;
  kcal: number;
  fiberG: number;
}

/** The three targets, exactly as `resolveAdherenceGoals` hands them out. */
export interface CatchUpGoals {
  netCarbsCeiling: number | null;
  proteinFloor: number | null;
  kcalTarget: number | null;
}

/** What the fasting side of the device has to say, already formatted by the caller. */
export interface CatchUpFast {
  status: 'none' | 'scheduled' | 'active';
  /** Wall-clock label for a scheduled start ("20:00"). */
  startsAtLabel?: string;
  /** How long a running fast has been running ("14 h"). */
  elapsedLabel?: string;
  /** Wall-clock label for the routine's usual start, when one is set. */
  routineStartLabel?: string;
  /**
   * Whether an active or completed fast covered yesterday.
   *
   * NOT derivable from `status`: a fast that ran all of yesterday and ended
   * this morning leaves `status: 'none'` behind it, and that is exactly the day
   * that must not read "0 meals".
   */
  coveredYesterday: boolean;
}

/** One food the person has logged, with the two figures a nudge ranks on. */
export interface CatchUpFood {
  /** The name as it was logged. Never re-worded. */
  name: string;
  proteinPer100g: number | null;
  fiberPer100g: number | null;
}

/** The six foods per nutrient a person with no history falls back to, already translated. */
export interface CatchUpFallbackFoods {
  protein: readonly string[];
  fiber: readonly string[];
}

export interface CatchUpInput {
  /**
   * Yesterday and the two days before it, NEWEST FIRST. Sorted defensively
   * inside, so a caller that hands them over oldest first still gets the right
   * "yesterday".
   */
  days: readonly CatchUpDay[];
  goals: CatchUpGoals;
  fast: CatchUpFast;
  /** The person's own logged foods, most recent first. */
  recentFoods: readonly CatchUpFood[];
  fallbackFoods: CatchUpFallbackFoods;
  /** The day the catch-up is FOR, device-local `YYYY-MM-DD`. */
  today: string;
  /** The active UI language, for the decimal separator. */
  locale: string;
  /** The caller's translator. Passed in, never imported, so this stays pure. */
  t: Translate;
}

export interface CatchUp {
  /** The day this catch-up is about, so a stale record can be recognised as one. */
  forDay: string;
  title: string;
  /** The notification body: lines one and two, cut at a word boundary. */
  body: string;
  /** Every line, in reading order. One to three of them. */
  lines: string[];
  url: typeof CATCH_UP_URL;
}

/** Which floor a nudge is about. */
type NudgeNutrient = 'protein' | 'fiber';

/** The i18n keys of the six fallback foods per nutrient, in the order they are offered. */
export const FALLBACK_FOOD_KEYS = {
  protein: [
    'catchUp.foods.eggs',
    'catchUp.foods.skyr',
    'catchUp.foods.chickenBreast',
    'catchUp.foods.tuna',
    'catchUp.foods.tofu',
    'catchUp.foods.lentils',
  ],
  fiber: [
    'catchUp.foods.chiaSeeds',
    'catchUp.foods.raspberries',
    'catchUp.foods.avocado',
    'catchUp.foods.broccoli',
    'catchUp.foods.flaxseed',
    'catchUp.foods.almonds',
  ],
} satisfies Record<NudgeNutrient, readonly string[]>;

/**
 * The fallback lists, translated. Kept beside the keys so a caller never has to
 * know which six foods stand in for a person with no history.
 *
 * @param t - the caller's translator.
 * @returns the six protein foods and the six fiber foods, in offer order.
 */
export function resolveFallbackFoods(t: Translate): CatchUpFallbackFoods {
  return {
    protein: FALLBACK_FOOD_KEYS.protein.map((key) => t(key)),
    fiber: FALLBACK_FOOD_KEYS.fiber.map((key) => t(key)),
  };
}

/** Whole grams, in the reader's own separators. A catch-up rounds: a decimal gram is noise in a sentence. */
function grams(value: number, locale: string): string {
  return formatMacroNumberIn(locale, Math.round(value));
}

/** Newest first, by day key. Total: equal keys keep their given order. */
function byDayKeyDescending(a: CatchUpDay, b: CatchUpDay): number {
  return b.dayKey.localeCompare(a.dayKey);
}

/**
 * Line one: yesterday, in one sentence.
 *
 * Four templates for the day with entries, one per combination of goals the
 * person has actually set, so a sentence never names a ceiling nobody chose.
 */
function yesterdayLine({
  yesterday,
  goals,
  fast,
  locale,
  t,
}: {
  yesterday: CatchUpDay | null;
  goals: CatchUpGoals;
  fast: CatchUpFast;
  locale: string;
  t: Translate;
}): string {
  if (yesterday === null || yesterday.meals === 0) {
    return fast.coveredYesterday ? t('catchUp.yesterdayFasting') : t('catchUp.yesterdayEmpty');
  }

  const meals = t(yesterday.meals === 1 ? 'catchUp.mealOne' : 'catchUp.mealMany', { count: yesterday.meals });
  const parts = {
    meals,
    netCarbs: grams(yesterday.netCarbsG, locale),
    protein: grams(yesterday.proteinG, locale),
    ceiling: goals.netCarbsCeiling === null ? '' : grams(goals.netCarbsCeiling, locale),
    floor: goals.proteinFloor === null ? '' : grams(goals.proteinFloor, locale),
  };

  if (goals.netCarbsCeiling !== null && goals.proteinFloor !== null) return t('catchUp.yesterdayFull', parts);
  if (goals.netCarbsCeiling !== null) return t('catchUp.yesterdayCeiling', parts);
  if (goals.proteinFloor !== null) return t('catchUp.yesterdayFloor', parts);
  return t('catchUp.yesterdayPlain', parts);
}

/**
 * Line two: what lies ahead, or nothing at all.
 *
 * A running fast beats a scheduled one, and both beat the routine: the routine
 * is what usually happens, and it has nothing to add once a real fast exists.
 * A device with none of the three gets no line rather than a filler sentence.
 */
function aheadLine(fast: CatchUpFast, t: Translate): string | null {
  if (fast.status === 'active' && fast.elapsedLabel !== undefined) {
    return t('catchUp.fastActive', { duration: fast.elapsedLabel });
  }
  if (fast.status === 'scheduled' && fast.startsAtLabel !== undefined) {
    return t('catchUp.fastScheduled', { time: fast.startsAtLabel });
  }
  if (fast.routineStartLabel !== undefined) return t('catchUp.fastRoutine', { time: fast.routineStartLabel });
  return null;
}

/** The day's figure for one nutrient. */
function consumedFor(day: CatchUpDay, nutrient: NudgeNutrient): number {
  return nutrient === 'protein' ? day.proteinG : day.fiberG;
}

/** One food's per-100 g figure for one nutrient, or null when the entry never carried it. */
function densityFor(food: CatchUpFood, nutrient: NudgeNutrient): number | null {
  return nutrient === 'protein' ? food.proteinPer100g : food.fiberPer100g;
}

/**
 * How many of the days the person LOGGED came in under `floor`.
 *
 * Empty days are not counted, in either direction. A day with no entries is a
 * day we know nothing about, and reading it as a zero would manufacture a
 * deficiency out of somebody simply not opening the app.
 */
function daysUnder({
  days,
  nutrient,
  floor,
}: {
  days: readonly CatchUpDay[];
  nutrient: NudgeNutrient;
  floor: number;
}): number {
  return days.filter((day) => day.meals > 0 && consumedFor(day, nutrient) < floor).length;
}

/**
 * The three foods a nudge names: the person's own, richest first, deduplicated
 * on the name as logged. A person with nothing in their history that carries
 * the nutrient gets the fallback list's first three.
 */
function nudgeFoods({
  nutrient,
  recentFoods,
  fallbackFoods,
}: {
  nutrient: NudgeNutrient;
  recentFoods: readonly CatchUpFood[];
  fallbackFoods: CatchUpFallbackFoods;
}): string[] {
  const seen = new Set<string>();
  const own: { name: string; density: number }[] = [];
  for (const food of recentFoods) {
    const density = densityFor(food, nutrient);
    if (density === null || density <= 0) continue;
    const key = food.name.trim().toLowerCase();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    own.push({ name: food.name, density });
  }
  if (own.length === 0) return [...fallbackFoods[nutrient]].slice(0, NUDGE_FOOD_COUNT);
  return own
    .toSorted((a, b) => b.density - a.density)
    .slice(0, NUDGE_FOOD_COUNT)
    .map((food) => food.name);
}

/** "a, b or c", with the first letter raised so the list can open a sentence. */
function listFoods(foods: readonly string[], t: Translate): string {
  const joined =
    foods.length <= 1 ?
      (foods[0] ?? '')
    : t('catchUp.foodsOr', { first: foods.slice(0, -1).join(', '), last: foods.at(-1) ?? '' });
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * Line three: one nudge, or none.
 *
 * Protein is asked first and fiber second, and the first one that qualifies
 * wins outright. Two nudges in one notification is a report card.
 */
function nudgeLine({
  days,
  yesterday,
  goals,
  recentFoods,
  fallbackFoods,
  t,
}: {
  days: readonly CatchUpDay[];
  yesterday: CatchUpDay | null;
  goals: CatchUpGoals;
  recentFoods: readonly CatchUpFood[];
  fallbackFoods: CatchUpFallbackFoods;
  t: Translate;
}): string | null {
  // Nothing was logged yesterday, so there is nothing to be factual about.
  if (yesterday === null || yesterday.meals === 0) return null;

  const candidates: { nutrient: NudgeNutrient; floor: number; factKey: string }[] = [
    ...(goals.proteinFloor === null ?
      []
    : [{ nutrient: 'protein' as const, floor: goals.proteinFloor, factKey: 'catchUp.nudgeProtein' }]),
    { nutrient: 'fiber' as const, floor: CATCH_UP_FIBER_REFERENCE_G, factKey: 'catchUp.nudgeFiber' },
  ];

  for (const candidate of candidates) {
    const under = daysUnder({ days, nutrient: candidate.nutrient, floor: candidate.floor });
    if (under < NUDGE_MINIMUM_DAYS) continue;
    const foods = nudgeFoods({ nutrient: candidate.nutrient, recentFoods, fallbackFoods });
    const fact = t(candidate.factKey, { days: t(under === NUDGE_MINIMUM_DAYS ? 'catchUp.countTwo' : 'catchUp.countThree') });
    return `${fact} ${t('catchUp.nudgeFoods', { foods: listFoods(foods, t) })}`;
  }
  return null;
}

/**
 * The notification body, cut at a word boundary with no ellipsis.
 *
 * No "…": an ellipsis promises a continuation the notification cannot show,
 * and the tap target already leads to the full text.
 */
export function truncateCatchUpBody(text: string): string {
  if (text.length <= CATCH_UP_BODY_MAX_LENGTH) return text;
  const head = text.slice(0, CATCH_UP_BODY_MAX_LENGTH + 1);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : text.slice(0, CATCH_UP_BODY_MAX_LENGTH);
  return cut.trimEnd();
}

/**
 * The morning catch-up: a title, one to three lines, and the body a push
 * notification shows.
 *
 * @param input - the last three days, the goals, the fast, the person's foods and the translator.
 * @returns the words, and the day they are about.
 */
export function buildCatchUp(input: CatchUpInput): CatchUp {
  const { goals, fast, recentFoods, fallbackFoods, today, locale, t } = input;
  const days = [...input.days].toSorted(byDayKeyDescending);
  const yesterday = days[0] ?? null;

  const first = yesterdayLine({ yesterday, goals, fast, locale, t });
  const second = aheadLine(fast, t);
  const third = nudgeLine({ days, yesterday, goals, recentFoods, fallbackFoods, t });

  const lines = [first, second, third].filter((line): line is string => line !== null);
  return {
    forDay: today,
    title: t('catchUp.title'),
    body: truncateCatchUpBody([first, second].filter((line): line is string => line !== null).join(' ')),
    lines,
    url: CATCH_UP_URL,
  };
}
