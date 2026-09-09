/**
 * Deterministic, explainable food suggestions for the diary drill-down
 * (M129/06): given the day's dominant nutrient gap and its remaining net-carb
 * headroom, rank a handful of foods that would close that gap without
 * spending headroom the user doesn't have.
 *
 * Three properties are load-bearing:
 *
 * 1. **Deterministic. No randomness, no clock, no network.** The day is an
 *    INPUT, not something this module reads: the caller passes the viewed
 *    day's `dateKey`, and that string alone decides which slice of the ranked
 *    pool is shown. The same day produces the same list every render, so a
 *    suggestion never shuffles out from under a tapping thumb, and every entry
 *    can be justified by the two numbers printed next to it. A different day
 *    rotates the list, which is why the day has to come in as an argument.
 * 2. **Pure.** Candidates come in as an argument, not from an import — the
 *    ranking is testable against a five-item fixture, and the real bundle
 *    (`#app/data/suggestion-foods`) is just the caller's default.
 * 3. **Fail-open.** Every "we can't help here" case (no gap, no candidates, no
 *    headroom for anything) returns an empty array, never an error. The UI
 *    renders nothing at all rather than an apology — a suggestion is an
 *    enrichment, and the drill-down is complete without it.
 */
import type { SuggestionCategory, SuggestionFood } from '#app/data/suggestion-foods';
import type { GapNutrient, Translate } from '#app/lib/macro-gaps';

/**
 * A serving must move the needle by at least this much of the gap nutrient to
 * be worth suggesting. Below it the food is technically "a source" and
 * practically noise — 0.4 g of protein from a cup of tea is not an answer to
 * "54 g protein to go".
 */
const MIN_GAIN_G = 1;

/**
 * Added to a serving's net-carb cost before dividing, so the score is finite
 * for a zero-carb food and doesn't wildly over-reward tiny differences at the
 * bottom of the range. Without it, chicken (0 g) would score as infinitely
 * better than salmon (0.1 g); with it, 0 g and 0.5 g land sensibly close while
 * a 9 g serving is still clearly penalised. 2 g is roughly "one bite of
 * something carby" — the smallest cost a user would actually notice.
 */
const CARB_COST_OFFSET_G = 2;

/**
 * Tolerance added to the headroom filter so a day sitting at exactly 0 g of
 * headroom still surfaces its zero-carb options (eggs, fish, hard cheese)
 * rather than going blank. A day that is over its ceiling genuinely shouldn't
 * be shown a bowl of berries; it can still be shown a chicken breast.
 */
const HEADROOM_TOLERANCE_G = 0.5;

/** Category cap for the first ranking pass, so five suggestions aren't five cuts of meat. */
const MAX_PER_CATEGORY = 2;

/**
 * How wide the day's rotation pool is, as a multiple of the display limit.
 * Wider than the limit is the whole point: a pool the size of the list has
 * nothing to rotate, and the person sees the same four foods forever. Three
 * times the limit keeps every rotated food a genuinely good answer to the gap
 * while giving the week somewhere to move.
 */
const ROTATION_POOL_MULTIPLIER = 3;

/** FNV-1a's standard 32-bit offset basis and prime. */
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * Folds a food name to the key both sides of the exclusion compare on:
 * diacritics stripped, trimmed, lower-cased. So a logged "Greek Yogurt "
 * excludes a suggested "greek yogurt", and a logged "Müsli" excludes "Musli".
 *
 * This module cannot import the app's other name normalisers (it takes no
 * route or store dependency, see the header), so it carries its own, following
 * the same `.trim().toLowerCase()` rule the rest of the app already uses.
 *
 * @param name - a food name from either side, logged or suggested.
 * @returns the comparison key.
 */
export function normaliseFoodName(name: string): string {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

/**
 * FNV-1a over a day key, the rotation's only source of variation.
 *
 * A hash rather than "days since an epoch" because the day arrives as a string
 * and parsing it would drag a calendar into a module that deliberately has no
 * clock. Exported so a test can pin the values rather than infer them.
 *
 * @param dateKey - the viewed day, `YYYY-MM-DD`.
 * @returns an unsigned 32-bit hash.
 */
export function hashDateKey(dateKey: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < dateKey.length; index += 1) {
    hash ^= dateKey.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** One ranked suggestion, carrying every number the UI prints — no recomputation at the call site. */
export interface FoodSuggestion {
  food: SuggestionFood;
  /** The serving this suggestion is quoted at, in grams. */
  servingGrams: number;
  /** Grams of the gap nutrient in that serving — the reason this food is here. */
  gainG: number;
  /** Net carbs in that serving — the cost of taking the suggestion. */
  netCarbsG: number;
  /** Calories in that serving. */
  kcal: number;
  /** The ranking score. Exposed for tests and debugging; never rendered. */
  score: number;
}

/** Grams of `value` per 100 g, scaled to a serving. */
function perServing(valuePer100g: number, servingGrams: number): number {
  return (valuePer100g * servingGrams) / 100;
}

/**
 * Scores one candidate: how much of the gap it closes, per unit of carb cost.
 *
 * The gain is CAPPED at the remaining gap before scoring — otherwise a 40 g
 * protein serving would outrank a 20 g one on a day that only needs 15 g more,
 * even though both close the gap completely and the smaller one is the more
 * sensible suggestion. Capping makes "closes the gap" the ceiling of the
 * numerator, after which only carb cost separates candidates.
 */
function scoreCandidate({ gainG, netCarbsG, remainingG }: { gainG: number; netCarbsG: number; remainingG: number }): number {
  return Math.min(gainG, remainingG) / (netCarbsG + CARB_COST_OFFSET_G);
}

/**
 * Takes up to `limit` suggestions, allowing at most `maxPerCategory` from any
 * one category, then — only if that leaves the list short — relaxes the cap
 * and fills from what's left in score order. Diversity is a preference, not a
 * reason to return three suggestions when five were asked for.
 */
function diversify(ranked: FoodSuggestion[], limit: number, maxPerCategory: number): FoodSuggestion[] {
  const perCategory = new Map<SuggestionCategory, number>();
  const picked: FoodSuggestion[] = [];
  const skipped: FoodSuggestion[] = [];

  for (const suggestion of ranked) {
    if (picked.length >= limit) break;
    const category = suggestion.food.category;
    const used = perCategory.get(category) ?? 0;
    if (used >= maxPerCategory) {
      skipped.push(suggestion);
      continue;
    }
    perCategory.set(category, used + 1);
    picked.push(suggestion);
  }

  for (const suggestion of skipped) {
    if (picked.length >= limit) break;
    picked.push(suggestion);
  }

  return picked;
}

/**
 * Best first, slug as the tie-break so the order is fully determined by the
 * data, never by the input array's incidental ordering.
 */
function compareSuggestions(a: FoodSuggestion, b: FoodSuggestion): number {
  return b.score !== a.score ? b.score - a.score : a.food.slug.localeCompare(b.food.slug);
}

/**
 * Turns the ranked list into the day's candidate order: the top
 * `limit * ROTATION_POOL_MULTIPLIER` candidates, walked circularly from an
 * offset the day key alone decides.
 *
 * A pool of `limit` or fewer has nothing to rotate, every candidate is going
 * to be shown anyway, so it is returned untouched, and a person with only
 * four qualifying foods sees the same four every day rather than a list that
 * reshuffles for no reason.
 */
function rotateForDay(ranked: FoodSuggestion[], limit: number, dateKey: string): FoodSuggestion[] {
  const pool = ranked.slice(0, limit * ROTATION_POOL_MULTIPLIER);
  if (pool.length <= limit) return pool;

  const offset = hashDateKey(dateKey) % pool.length;
  const rotated: FoodSuggestion[] = [];
  for (let step = 0; step < pool.length; step += 1) {
    rotated.push(pool[(offset + step) % pool.length]);
  }
  return rotated;
}

/**
 * Ranks the foods that best close `nutrient`'s remaining gap within the day's
 * carb headroom.
 *
 * @param foods - the candidate pool (the bundled dataset, or a fixture in tests).
 * @param nutrient - which floor the day is short on (see `computeDayGaps`'s `dominantGap`).
 * @param remainingG - grams of that nutrient still needed. A non-positive value returns `[]`.
 * @param carbHeadroomG - grams of net carbs available to spend, or null when the user has no ceiling (no filter is applied — carb cost still shapes the ranking through the score).
 * @param limit - how many suggestions to return.
 * @param dateKey - the viewed day, `YYYY-MM-DD`. Decides which slice of the wider ranked pool is shown, so the list is stable within a day and rotates across days.
 * @param loggedFoodNames - what the person already logged that day. Matched by `normaliseFoodName` and dropped before ranking, because "eat some Greek yogurt" is a poor answer to a day that already had Greek yogurt.
 * @returns up to `limit` suggestions, best first, at most `MAX_PER_CATEGORY` per category where possible. Empty whenever nothing qualifies.
 */
export function rankFoodSuggestions({
  foods,
  nutrient,
  remainingG,
  carbHeadroomG,
  limit,
  dateKey,
  loggedFoodNames,
}: {
  foods: readonly SuggestionFood[];
  nutrient: GapNutrient;
  remainingG: number;
  carbHeadroomG: number | null;
  limit: number;
  dateKey: string;
  loggedFoodNames: readonly string[];
}): FoodSuggestion[] {
  if (limit <= 0 || remainingG <= 0 || foods.length === 0) return [];

  const alreadyLogged = new Set(loggedFoodNames.map(normaliseFoodName));

  // A day already past its ceiling has 0 g to spend, not a negative budget —
  // clamping here is what keeps the zero-carb options available rather than
  // filtering every food out with an impossible threshold.
  const budgetG = carbHeadroomG === null ? null : Math.max(0, carbHeadroomG) + HEADROOM_TOLERANCE_G;

  const ranked: FoodSuggestion[] = [];
  for (const food of foods) {
    if (alreadyLogged.has(normaliseFoodName(food.name))) continue;

    const servingGrams = food.servingGrams;
    if (servingGrams <= 0) continue;

    const gainG = perServing(food.per100g[nutrient], servingGrams);
    if (gainG < MIN_GAIN_G) continue;

    const netCarbsG = perServing(food.per100g.netCarbs, servingGrams);
    if (budgetG !== null && netCarbsG > budgetG) continue;

    ranked.push({
      food,
      servingGrams,
      gainG,
      netCarbsG,
      kcal: perServing(food.per100g.kcal, servingGrams),
      score: scoreCandidate({ gainG, netCarbsG, remainingG }),
    });
  }

  ranked.sort(compareSuggestions);

  // Rotate first, then diversify, then sort what survived back into score
  // order: the rotation decides WHICH foods this day gets, the category cap
  // still applies to that selection, and the reader still sees the best of
  // them first rather than a list that starts wherever the hash landed.
  return diversify(rotateForDay(ranked, limit, dateKey), limit, MAX_PER_CATEGORY).toSorted(compareSuggestions);
}

/**
 * The suggestion row's one-line reason — "+21 g protein · 1.3 g net carbs".
 * Pure, so the phrasing is pinned by a test rather than by a screenshot.
 *
 * @param suggestion - the ranked suggestion.
 * @param nutrient - the gap it was ranked to close (names the gain).
 * @param formatGrams - the app's shared gram formatter (injected to keep this module dependency-free).
 * @param t - the caller's translator, injected for the same reason.
 * @returns the phrase to render under the food's name.
 */
export function describeSuggestion(
  suggestion: FoodSuggestion,
  nutrient: GapNutrient,
  formatGrams: (value: number) => string,
  t: Translate,
): string {
  return t('diary.suggestions.reason', {
    gain: formatGrams(suggestion.gainG),
    // The nutrient is a lower-case noun mid-sentence, so it comes from the
    // shared `diary.nutrients.*` group rather than being interpolated raw.
    nutrient: t(`diary.nutrients.${nutrient}`),
    carbs: formatGrams(suggestion.netCarbsG),
  });
}
