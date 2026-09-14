/**
 * "Your usual <slot>" ranking (M227/01), pure coverage of
 * `#app/lib/local-store/local-slot-suggestions`. No store, no browser, no
 * clock: the logs, the saved meals, the slot and "now" are all passed in, the
 * precedent `saved-meals.test.ts` and `copy-day.test.ts` already set.
 *
 * TWO CONTROLS CARRY THIS FILE, and both are written as a pair so an
 * assertion of ABSENCE can actually fail:
 *
 *  1. A food only ever eaten at dinner is not offered at breakfast. The pair
 *     is the same input asked for dinner, where it IS offered, so "empty" can
 *     never be the answer to a selector that returns nothing at all.
 *  2. A food eaten three times on ONE day ranks below one eaten on two days.
 *     The pair is the raw log count, asserted to be the other way round, so a
 *     selector that reverted to counting logs fails instead of passing on a
 *     tie.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSlotSuggestions,
  findSlotSuggestion,
  toUsualAtSlotOffer,
  SLOT_SUGGESTION_LIMIT,
} from '../../app/lib/local-store/local-slot-suggestions';
import type { LocalFoodLog, LocalSavedMeal } from '../../app/lib/local-store/schema';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The instant every test asks "what is usual right now" at. */
const NOW_MS = Date.parse('2026-09-14T08:30:00Z');

/** Builds the `YYYY-MM-DD` key `daysAgo` days before `NOW_MS`, in UTC (the tests' only zone). */
function dayKeyAgo(daysAgo: number): string {
  return new Date(NOW_MS - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** A complete food log, defaulted to a breakfast one day ago; override any field per test. */
function log(overrides: Partial<LocalFoodLog> & { name: string }): LocalFoodLog {
  const daysAgo = 1;
  return {
    id: `${overrides.name}-${overrides.loggedAt ?? daysAgo}`,
    quantityGrams: 100,
    macros: { carbs: 10, fiber: 2, sugars: 3, polyols: null, protein: 5, fat: 4, kcal: 120 },
    mealType: 'breakfast',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: dayKeyAgo(daysAgo),
    loggedAt: NOW_MS - daysAgo * DAY_MS,
    createdAt: NOW_MS - daysAgo * DAY_MS,
    logBatchId: null,
    ...overrides,
  };
}

/** A log placed on a named day, at a named hour offset inside it. */
function logOnDay({
  name,
  daysAgo,
  mealType,
  hourOffset = 0,
}: {
  name: string;
  daysAgo: number;
  mealType: LocalFoodLog['mealType'];
  hourOffset?: number;
}): LocalFoodLog {
  const loggedAt = NOW_MS - daysAgo * DAY_MS + hourOffset * HOUR_MS;
  return log({ name, mealType, dayKey: dayKeyAgo(daysAgo), loggedAt, createdAt: loggedAt, id: `${name}-${loggedAt}` });
}

/** The names the selector offers, in rank order. */
function offeredNames(logs: readonly LocalFoodLog[], slot: LocalFoodLog['mealType'] & string, meals: LocalSavedMeal[] = []): string[] {
  return computeSlotSuggestions({
    logs,
    savedMeals: meals,
    slot,
    nowMs: NOW_MS,
    limit: SLOT_SUGGESTION_LIMIT,
  }).map((suggestion) => suggestion.name);
}

describe('the slot filter', () => {
  // CONTROL, half one. Porridge exists in the logs and is genuinely usual,
  // it is simply never eaten at this hour.
  it('does not offer a food only ever logged at dinner when the slot is breakfast', () => {
    const logs = [
      logOnDay({ name: 'Lasagne', daysAgo: 1, mealType: 'dinner' }),
      logOnDay({ name: 'Lasagne', daysAgo: 2, mealType: 'dinner' }),
      logOnDay({ name: 'Lasagne', daysAgo: 3, mealType: 'dinner' }),
    ];

    assert.deepEqual(offeredNames(logs, 'breakfast'), []);
  });

  // CONTROL, half two. The SAME logs at the slot they belong to, so the
  // assertion above is about the filter and not about a selector that answers
  // nothing to everything.
  it('offers that same food at dinner, which is what makes the breakfast answer meaningful', () => {
    const logs = [
      logOnDay({ name: 'Lasagne', daysAgo: 1, mealType: 'dinner' }),
      logOnDay({ name: 'Lasagne', daysAgo: 2, mealType: 'dinner' }),
      logOnDay({ name: 'Lasagne', daysAgo: 3, mealType: 'dinner' }),
    ];

    assert.deepEqual(offeredNames(logs, 'dinner'), ['Lasagne']);
  });

  it('ignores an entry with no meal at all, which belongs to no slot', () => {
    const logs = [logOnDay({ name: 'Apple', daysAgo: 1, mealType: null })];

    assert.deepEqual(offeredNames(logs, 'breakfast'), []);
    assert.deepEqual(offeredNames(logs, 'snack'), []);
  });
});

describe('the ranking', () => {
  /** Three helpings of cake on ONE day; porridge on two separate days. */
  const logs = [
    logOnDay({ name: 'Cake', daysAgo: 1, mealType: 'breakfast', hourOffset: 1 }),
    logOnDay({ name: 'Cake', daysAgo: 1, mealType: 'breakfast', hourOffset: 2 }),
    logOnDay({ name: 'Cake', daysAgo: 1, mealType: 'breakfast', hourOffset: 3 }),
    logOnDay({ name: 'Porridge', daysAgo: 2, mealType: 'breakfast' }),
    logOnDay({ name: 'Porridge', daysAgo: 3, mealType: 'breakfast' }),
  ];

  // CONTROL, half one.
  it('ranks a food eaten on two days above one eaten three times on a single day', () => {
    assert.deepEqual(offeredNames(logs, 'breakfast'), ['Porridge', 'Cake']);
  });

  // CONTROL, half two: the raw log count points the OTHER way, so a selector
  // that counted logs instead of days would have to fail this file rather than
  // pass it by coincidence.
  it('is not the raw log count, which favours the single heavy day', () => {
    const cakeLogs = logs.filter((entry) => entry.name === 'Cake').length;
    const porridgeLogs = logs.filter((entry) => entry.name === 'Porridge').length;
    assert.ok(cakeLogs > porridgeLogs, 'the fixture no longer poses the question this test asks');

    const ranked = computeSlotSuggestions({
      logs,
      savedMeals: [],
      slot: 'breakfast',
      nowMs: NOW_MS,
      limit: SLOT_SUGGESTION_LIMIT,
    });
    assert.deepEqual(
      ranked.map((suggestion) => suggestion.dayCount),
      [2, 1],
    );
  });

  it('breaks a tie on recency, most recent first', () => {
    const tied = [
      logOnDay({ name: 'Older', daysAgo: 5, mealType: 'breakfast' }),
      logOnDay({ name: 'Newer', daysAgo: 2, mealType: 'breakfast' }),
    ];

    assert.deepEqual(offeredNames(tied, 'breakfast'), ['Newer', 'Older']);
  });

  it('groups a food case-insensitively, so one habit is one offer', () => {
    const mixed = [
      logOnDay({ name: 'Porridge', daysAgo: 1, mealType: 'breakfast' }),
      logOnDay({ name: 'porridge', daysAgo: 2, mealType: 'breakfast' }),
    ];

    const ranked = computeSlotSuggestions({
      logs: mixed,
      savedMeals: [],
      slot: 'breakfast',
      nowMs: NOW_MS,
      limit: SLOT_SUGGESTION_LIMIT,
    });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.dayCount, 2);
    // The most recent casing wins, exactly as `computeLocalRecentFoods` does.
    assert.equal(ranked[0]?.name, 'Porridge');
  });

  it('caps the list at the limit it is given', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].flatMap((name, index) => [
      logOnDay({ name, daysAgo: index + 1, mealType: 'breakfast' }),
      logOnDay({ name, daysAgo: index + 2, mealType: 'breakfast' }),
    ]);

    assert.equal(offeredNames(many, 'breakfast').length, SLOT_SUGGESTION_LIMIT);
  });
});

describe('the lookback window', () => {
  // CONTROL, half one: "usual" is a claim about now, so a habit from two
  // years ago is not offered.
  it('drops a log older than the window, however often it was eaten', () => {
    const ancient = [200, 201, 202, 203].map((daysAgo) =>
      logOnDay({ name: 'Toast', daysAgo, mealType: 'breakfast' }),
    );

    assert.deepEqual(offeredNames(ancient, 'breakfast'), []);
  });

  // CONTROL, half two: the same four logs inside the window ARE offered.
  it('keeps the same food when the logs are recent', () => {
    const recent = [1, 2, 3, 4].map((daysAgo) => logOnDay({ name: 'Toast', daysAgo, mealType: 'breakfast' }));

    assert.deepEqual(offeredNames(recent, 'breakfast'), ['Toast']);
  });
});

describe('saved meals', () => {
  const sundayBreakfast: LocalSavedMeal = {
    id: 'meal-sunday',
    name: 'Sunday breakfast',
    items: [
      { name: 'Porridge', quantityGrams: 250, macros: { carbs: 30, fiber: 4, sugars: 2, polyols: null, protein: 8, fat: 5, kcal: 220 }, source: 'manual', aiEstimated: false, curatedSource: null, foodId: null },
      { name: 'Coffee', quantityGrams: 200, macros: { carbs: 0, fiber: 0, sugars: 0, polyols: null, protein: 0, fat: 0, kcal: 2 }, source: 'manual', aiEstimated: false, curatedSource: null, foodId: null },
    ],
    createdAt: NOW_MS - 30 * DAY_MS,
  };

  it('leads the list when its items were eaten in this slot', () => {
    const logs = [
      logOnDay({ name: 'Porridge', daysAgo: 1, mealType: 'breakfast' }),
      logOnDay({ name: 'Porridge', daysAgo: 2, mealType: 'breakfast' }),
      logOnDay({ name: 'Eggs', daysAgo: 1, mealType: 'breakfast' }),
      logOnDay({ name: 'Eggs', daysAgo: 2, mealType: 'breakfast' }),
      logOnDay({ name: 'Eggs', daysAgo: 3, mealType: 'breakfast' }),
    ];

    // Eggs has the higher day count and still ranks below the bundle: a meal
    // is one tap for several rows, so it leads its group.
    assert.deepEqual(offeredNames(logs, 'breakfast', [sundayBreakfast]), ['Sunday breakfast', 'Eggs', 'Porridge']);
  });

  // CONTROL: the same bundle, the same device, the wrong slot.
  it('is not offered at a slot none of its items was ever eaten at', () => {
    const logs = [
      logOnDay({ name: 'Porridge', daysAgo: 1, mealType: 'breakfast' }),
      logOnDay({ name: 'Porridge', daysAgo: 2, mealType: 'breakfast' }),
    ];

    assert.deepEqual(offeredNames(logs, 'dinner', [sundayBreakfast]), []);
  });

  it('carries every item, so one tap writes the whole bundle', () => {
    const logs = [logOnDay({ name: 'Porridge', daysAgo: 1, mealType: 'breakfast' })];
    const ranked = computeSlotSuggestions({
      logs,
      savedMeals: [sundayBreakfast],
      slot: 'breakfast',
      nowMs: NOW_MS,
      limit: SLOT_SUGGESTION_LIMIT,
    });

    const bundle = ranked.find((suggestion) => suggestion.kind === 'saved-meal');
    assert.ok(bundle, 'the bundle is no longer offered');
    assert.deepEqual(
      bundle.items.map((item) => item.name),
      ['Porridge', 'Coffee'],
    );
    assert.equal(toUsualAtSlotOffer(bundle).itemCount, 2);
  });
});

describe('what a single food carries into its entry', () => {
  it('passes the whole snapshot of the most recent log, not just the name', () => {
    const logs = [
      logOnDay({ name: 'Bran', daysAgo: 3, mealType: 'breakfast' }),
      log({
        name: 'Bran',
        mealType: 'breakfast',
        dayKey: dayKeyAgo(1),
        loggedAt: NOW_MS - DAY_MS,
        quantityGrams: 40,
        curatedSource: 'lowcarbcheck:wheat-bran',
        attribution: 'Bundeslebensmittelschluessel (BLS) 4.0, CC BY 4.0 (adapted)',
        netCarbsPer100g: 21.7,
        carbBasis: 'available',
        portion: { unit: 'cup', quantity: 1, gramsPerUnit: 40 },
      }),
    ];

    const ranked = computeSlotSuggestions({
      logs,
      savedMeals: [],
      slot: 'breakfast',
      nowMs: NOW_MS,
      limit: SLOT_SUGGESTION_LIMIT,
    });
    const item = ranked[0]?.items[0];
    assert.ok(item, 'the food is no longer offered');
    // The MOST RECENT log's snapshot, credit and authoritative figure intact,
    // which is what stops a one-tap re-log producing a different day total
    // from the same food logged any other way.
    assert.equal(item.quantityGrams, 40);
    assert.equal(item.curatedSource, 'lowcarbcheck:wheat-bran');
    assert.equal(item.netCarbsPer100g, 21.7);
    assert.equal(item.carbBasis, 'available');
    assert.deepEqual(item.portion, { unit: 'cup', quantity: 1, gramsPerUnit: 40 });
    assert.ok(item.attribution?.includes('CC BY 4.0'));
  });
});

describe('findSlotSuggestion', () => {
  /** Four distinct breakfast habits, so the top three cannot hold all of them. */
  const logs = ['A', 'B', 'C', 'D'].flatMap((name, index) => [
    logOnDay({ name, daysAgo: index + 1, mealType: 'breakfast' }),
    logOnDay({ name, daysAgo: index + 2, mealType: 'breakfast' }),
  ]);

  it('finds an offer that a later log has pushed past the rendered cap', () => {
    const rendered = computeSlotSuggestions({
      logs,
      savedMeals: [],
      slot: 'breakfast',
      nowMs: NOW_MS,
      limit: SLOT_SUGGESTION_LIMIT,
    });
    assert.equal(rendered.length, SLOT_SUGGESTION_LIMIT, 'the fixture no longer exceeds the cap');

    const found = findSlotSuggestion({ logs, savedMeals: [], slot: 'breakfast', nowMs: NOW_MS, id: 'food:d' });

    assert.ok(found, 'a tapped offer outside the cap must still be findable');
    assert.equal(found.name, 'D');
  });

  it('answers null for an id that no longer qualifies', () => {
    assert.equal(
      findSlotSuggestion({ logs, savedMeals: [], slot: 'dinner', nowMs: NOW_MS, id: 'food:a' }),
      null,
    );
  });
});
