import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLocalRecentFoods,
  federateLocalQuickAddCandidates,
  localCuratedMatchToCandidate,
  localFoodToCandidate,
  localRecentFoodToCandidate,
  selectLocalFrequentChips,
  type LocalQuickAddCandidate,
  type LocalRecentFood,
} from '../../app/lib/local-store/local-quick-add';
import type { LocalFoodLog, LocalPersonalFood } from '../../app/lib/local-store/schema';
import type { Macros } from '../../app/lib/macros';
import type { FoodMatch } from '../../app/services/food-resolution';
import type { DisplayPortion } from '../../app/lib/portions';

const NULL_MACROS: Macros = {
  carbs: null,
  fiber: null,
  sugars: null,
  polyols: null,
  protein: null,
  fat: null,
  kcal: null,
};

function log(overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id: 'log-1',
    name: 'Chicken breast',
    quantityGrams: 150,
    macros: { ...NULL_MACROS, carbs: 0, protein: 46.5 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-01-15',
    loggedAt: 1_000,
    createdAt: 1_000,
    logBatchId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeLocalRecentFoods
// ---------------------------------------------------------------------------

test('dedupes by case-insensitive name, ranking by times-logged then recency', () => {
  const logs = [
    log({ id: 'a', name: 'Eggs', loggedAt: 1_000 }),
    log({ id: 'b', name: 'eggs', loggedAt: 2_000 }),
    log({ id: 'c', name: 'Bacon', loggedAt: 3_000 }),
  ];
  const recents = computeLocalRecentFoods(logs, { limit: 10 });
  assert.equal(recents.length, 2);
  // Eggs logged twice outranks Bacon logged once, even though Bacon is more recent.
  assert.equal(recents[0].name, 'eggs');
  assert.equal(recents[0].timesLogged, 2);
  // The most-recently-logged casing/snapshot wins as the reusable "latest".
  assert.equal(recents[0].lastLoggedAt, 2_000);
  assert.equal(recents[1].name, 'Bacon');
});

test('ties in times-logged break by most-recent lastLoggedAt', () => {
  const logs = [log({ id: 'a', name: 'Toast', loggedAt: 1_000 }), log({ id: 'b', name: 'Yogurt', loggedAt: 5_000 })];
  const recents = computeLocalRecentFoods(logs, { limit: 10 });
  assert.equal(recents[0].name, 'Yogurt');
  assert.equal(recents[1].name, 'Toast');
});

test('respects the limit', () => {
  const logs = [log({ id: 'a', name: 'A' }), log({ id: 'b', name: 'B' }), log({ id: 'c', name: 'C' })];
  assert.equal(computeLocalRecentFoods(logs, { limit: 1 }).length, 1);
});

test('an empty-name log is skipped', () => {
  const logs = [log({ id: 'a', name: '   ' })];
  assert.equal(computeLocalRecentFoods(logs, { limit: 10 }).length, 0);
});

test("carries the most recent log entry's chosen portion through", () => {
  const portion: DisplayPortion = { unit: 'egg', quantity: 2, gramsPerUnit: 50 };
  const logs = [
    log({ id: 'a', name: 'Eggs', loggedAt: 1_000, portion: { unit: 'egg', quantity: 1, gramsPerUnit: 50 } }),
    log({ id: 'b', name: 'eggs', loggedAt: 2_000, portion }),
  ];
  const recents = computeLocalRecentFoods(logs, { limit: 10 });
  // The latest (most-recent) log's portion wins, not the earliest.
  assert.deepStrictEqual(recents[0].portion, portion);
});

test('a gram-only log (no portion field) surfaces as portion: null, never throws', () => {
  const logs = [log({ id: 'a', name: 'Chicken breast' })];
  const recents = computeLocalRecentFoods(logs, { limit: 10 });
  assert.equal(recents[0].portion, null);
});

// ---------------------------------------------------------------------------
// selectLocalFrequentChips
// ---------------------------------------------------------------------------

function recentFood(overrides: Partial<LocalRecentFood> = {}): LocalRecentFood {
  return {
    name: 'Eggs',
    lastQuantityGrams: 100,
    lastLoggedAt: 1_000,
    timesLogged: 3,
    foodId: null,
    curatedSource: null,
    aiEstimated: false,
    macros: { ...NULL_MACROS, carbs: 1, fiber: 0, polyols: 0 },
    portion: null,
    attribution: null,
    ...overrides,
  };
}

test('only foods meeting the minTimesLogged floor become chips', () => {
  const chips = selectLocalFrequentChips([recentFood({ timesLogged: 1 }), recentFood({ timesLogged: 5 })], {
    limit: 10,
    minTimesLogged: 2,
  });
  assert.equal(chips.length, 1);
  assert.equal(chips[0].timesLogged, 5);
});

test('a chip with unknown carbs gets no carbStatus dot (never a fabricated one)', () => {
  const chips = selectLocalFrequentChips([recentFood({ macros: NULL_MACROS, timesLogged: 2 })], {
    limit: 10,
    minTimesLogged: 2,
  });
  assert.equal(chips[0].carbStatus, null);
});

// ---------------------------------------------------------------------------
// Candidate mapping + federation
// ---------------------------------------------------------------------------

test('localRecentFoodToCandidate recovers the per-100g basis from the per-serving snapshot', () => {
  const candidate = localRecentFoodToCandidate(
    recentFood({ macros: { ...NULL_MACROS, carbs: 20 }, lastQuantityGrams: 200 }),
  );
  assert.equal(candidate.source, 'recent');
  assert.equal(candidate.macrosPer100g.carbs, 10);
  assert.equal(candidate.defaultGrams, 200);
});

test('localRecentFoodToCandidate passes the recent log’s ACTUAL portion through unchanged (never re-derived)', () => {
  const portion: DisplayPortion = { unit: 'banana', quantity: 2, gramsPerUnit: 118 };
  const candidate = localRecentFoodToCandidate(recentFood({ portion }));
  assert.deepStrictEqual(candidate.defaultPortion, portion);
});

test('localRecentFoodToCandidate has a null defaultPortion for a gram-only recent', () => {
  const candidate = localRecentFoodToCandidate(recentFood({ portion: null }));
  assert.equal(candidate.defaultPortion, null);
});

// ---------------------------------------------------------------------------
// Default-portion resolution (M12x household portions) — selecting a food
// preselects its most natural portion, never a flat 100 g.
// ---------------------------------------------------------------------------

test('localFoodToCandidate resolves a household-unit default from the food name, replacing the flat 100 g default', () => {
  const food: LocalPersonalFood = {
    id: 'food-1',
    name: 'Eggs',
    brand: null,
    macrosPer100g: { ...NULL_MACROS, carbs: 1 },
    source: 'user',
    createdAt: 1_000,
  };
  const candidate = localFoodToCandidate(food);
  assert.deepStrictEqual(candidate.defaultPortion, { unit: 'egg', quantity: 1, gramsPerUnit: 50 });
  assert.equal(candidate.defaultGrams, 50);
});

test('localFoodToCandidate falls back to 100 g when no household unit matches the name', () => {
  const food: LocalPersonalFood = {
    id: 'food-2',
    name: 'Tofu',
    brand: null,
    macrosPer100g: { ...NULL_MACROS, carbs: 2 },
    source: 'user',
    createdAt: 1_000,
  };
  const candidate = localFoodToCandidate(food);
  assert.equal(candidate.defaultPortion, null);
  assert.equal(candidate.defaultGrams, 100);
});

test('localCuratedMatchToCandidate prefers the upstream portionSize over the household table’s generic weight', () => {
  // A curated "Egg" row's own measured portionSize (55g) beats the generic 50g reference.
  const match = buildFoodMatch({ title: 'Egg', canonicalName: 'Egg', portionSize: 55 });
  const candidate = localCuratedMatchToCandidate(match);
  assert.deepStrictEqual(candidate.defaultPortion, { unit: 'egg', quantity: 1, gramsPerUnit: 55 });
  assert.equal(candidate.defaultGrams, 55);
});

test('localCuratedMatchToCandidate falls back to a generic "1 serving" from portionSize when no unit name matches', () => {
  const match = buildFoodMatch({ title: 'Acerola', canonicalName: 'Acerola', portionSize: 150 });
  const candidate = localCuratedMatchToCandidate(match);
  assert.deepStrictEqual(candidate.defaultPortion, { unit: 'serving', quantity: 1, gramsPerUnit: 150 });
  assert.equal(candidate.defaultGrams, 150);
});

test('localCuratedMatchToCandidate falls back to 100 g when neither portionSize nor a unit name is available', () => {
  const match = buildFoodMatch({ title: 'Acerola', canonicalName: 'Acerola', portionSize: null });
  const candidate = localCuratedMatchToCandidate(match);
  assert.equal(candidate.defaultPortion, null);
  assert.equal(candidate.defaultGrams, 100);
});

test('localCuratedMatchToCandidate matches the household unit against canonicalName, not the localized title', () => {
  // A German-locale title shouldn't defeat English-keyword matching — canonicalName carries the English name.
  const match = buildFoodMatch({ title: 'Ei', canonicalName: 'Egg', locale: 'de', portionSize: null });
  const candidate = localCuratedMatchToCandidate(match);
  assert.deepStrictEqual(candidate.defaultPortion, { unit: 'egg', quantity: 1, gramsPerUnit: 50 });
});

test('localFoodToCandidate carries the personal food id straight through (string, not remapped)', () => {
  const food: LocalPersonalFood = {
    id: 'food-42',
    name: 'Tofu',
    brand: null,
    macrosPer100g: { ...NULL_MACROS, carbs: 2 },
    source: 'user',
    createdAt: 1_000,
  };
  const candidate = localFoodToCandidate(food);
  assert.equal(candidate.source, 'custom');
  assert.equal(candidate.foodId, 'food-42');
});

function buildFoodMatch(overrides: Partial<FoodMatch> = {}): FoodMatch {
  return {
    slug: 'acerola',
    title: 'Acerola',
    canonicalName: 'Acerola',
    locale: 'en',
    macrosPer100g: { ...NULL_MACROS, carbs: 11 },
    netCarbsPer100g: 11,
    score: 0.9,
    imageUrl: null,
    url: 'https://lowcarbcheck.org/acerola',
    attribution: 'Data by LowCarbCheck',
    origin: null,
    portionSize: null,
    ...overrides,
  };
}

test('localCuratedMatchToCandidate always has a null foodId (curated matches are never linked to a personal food)', () => {
  const candidate = localCuratedMatchToCandidate(buildFoodMatch());
  assert.equal(candidate.foodId, null);
  assert.equal(candidate.curatedSource, 'lowcarbcheck:acerola');
});

test('localCuratedMatchToCandidate passes match.netCarbsPer100g straight through, never recomputing it', () => {
  // BLS-shaped case: fiber is genuinely unknown (null, not 0). A naive
  // `carbs - (fiber ?? 0)` recompute would fabricate 11 as the net-carb
  // figure; LCC's own origin-aware value (say, 4 after subtracting the real,
  // unpublished fiber content) must survive unchanged onto the candidate.
  const match = buildFoodMatch({
    macrosPer100g: { ...NULL_MACROS, carbs: 11, fiber: null },
    netCarbsPer100g: 4,
    origin: 'bls',
  });
  const candidate = localCuratedMatchToCandidate(match);
  assert.equal(candidate.authoritativeNetCarbsPer100g, 4);
});

test('localCuratedMatchToCandidate preserves a null netCarbsPer100g (never fabricates 0)', () => {
  const match = buildFoodMatch({ netCarbsPer100g: null });
  const candidate = localCuratedMatchToCandidate(match);
  assert.equal(candidate.authoritativeNetCarbsPer100g, null);
});

test('localRecentFoodToCandidate carries the original log’s authoritative figure through verbatim', () => {
  // The log this recent food was derived from had an upstream figure of 4,
  // while its own macros would estimate `20 - 5 = 15`. The candidate must
  // carry 4: /add's "Recent" row and the diary's favourite chip re-log the
  // same food and have to store the same number.
  const candidate = localRecentFoodToCandidate(
    recentFood({ macros: { ...NULL_MACROS, carbs: 20, fiber: 5 }, lastQuantityGrams: 100, netCarbsPer100g: 4 }),
  );
  assert.equal(candidate.authoritativeNetCarbsPer100g, 4);
});

test('localRecentFoodToCandidate keeps "upstream had none" (null) distinct from "never captured" (absent)', () => {
  const consulted = localRecentFoodToCandidate(recentFood({ netCarbsPer100g: null }));
  assert.equal(consulted.authoritativeNetCarbsPer100g, null);

  const neverCaptured = localRecentFoodToCandidate(recentFood());
  assert.equal(neverCaptured.authoritativeNetCarbsPer100g, undefined);
});

test('localFoodToCandidate claims no authoritative figure for a hand-typed food — the person who typed the macros IS the source', () => {
  const customCandidate = localFoodToCandidate({
    id: 'food-1',
    name: 'Tofu',
    brand: null,
    macrosPer100g: { ...NULL_MACROS, carbs: 2 },
    source: 'user',
    createdAt: 1_000,
  });
  assert.equal(customCandidate.authoritativeNetCarbsPer100g, undefined);
  // ...and the key is still spelled out, so the compiler can't be satisfied by
  // an omission (see the field's doc on `LocalQuickAddCandidate`).
  assert.equal('authoritativeNetCarbsPer100g' in customCandidate, true);
});

test('localFoodToCandidate passes a STORED figure through — a scan-created food really does have an upstream one', () => {
  // The other half of the rule above: a personal food created by the scan
  // confirm step from an applied curated match carries that match's figure, and
  // this candidate must surface it rather than hardcoding "no figure" (the
  // defect: /add's "Your food" row re-derived a double-subtracted 0 while the
  // same food's diary entry read the real number).
  const scanned = localFoodToCandidate({
    id: 'food-2',
    name: 'Wheat bran',
    brand: null,
    macrosPer100g: { ...NULL_MACROS, carbs: 21.7, fiber: 42.8 },
    source: 'plate_ai',
    createdAt: 2_000,
    netCarbsPer100g: 21.7,
  });
  assert.equal(scanned.authoritativeNetCarbsPer100g, 21.7);
});

test('localFoodToCandidate keeps "upstream had none" (null) distinct from "never captured" (absent)', () => {
  const consulted = localFoodToCandidate({
    id: 'food-3',
    name: 'Mystery bar',
    brand: null,
    macrosPer100g: { ...NULL_MACROS, carbs: 12 },
    source: 'plate_ai',
    createdAt: 3_000,
    netCarbsPer100g: null,
  });
  assert.equal(consulted.authoritativeNetCarbsPer100g, null);
});

test('federateLocalQuickAddCandidates dedupes by name, recents outranking custom outranking curated', () => {
  const recent: LocalQuickAddCandidate[] = [{ ...blankCandidate(), source: 'recent', name: 'Eggs' }];
  const custom: LocalQuickAddCandidate[] = [
    { ...blankCandidate(), source: 'custom', name: 'eggs' },
    { ...blankCandidate(), source: 'custom', name: 'Bacon' },
  ];
  const curated: LocalQuickAddCandidate[] = [{ ...blankCandidate(), source: 'curated', name: 'Bacon' }];

  const merged = federateLocalQuickAddCandidates({ recent, custom, curated });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].source, 'recent');
  assert.equal(merged[1].source, 'custom');
});

function blankCandidate(): LocalQuickAddCandidate {
  return {
    source: 'custom',
    name: '',
    macrosPer100g: NULL_MACROS,
    authoritativeNetCarbsPer100g: undefined,
    defaultGrams: 100,
    defaultPortion: null,
    curatedSource: null,
    foodId: null,
    aiEstimated: false,
    imageUrl: null,
    timesLogged: 0,
    url: null,
    attribution: null,
  };
}
