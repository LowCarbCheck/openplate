/**
 * Unit tests for the per-nutrient daily aggregation
 * (`app/lib/local-store/aggregates`'s `computeDailyMicronutrients` /
 * `computeDailyMicronutrientsInRange`).
 *
 * These exist to pin ONE rule, the one this whole dimension is built around:
 * **an unknown is not zero.** A food with no figure for a nutrient contributes
 * nothing to the day's intake AND drags its coverage down; a food with a
 * measured `0` contributes 0 AND counts as covered. If those two ever behave
 * the same way, a day of mostly-unlogged-micronutrient food reads as a
 * confident, low intake — which is exactly the false "you're low on magnesium"
 * the milestone forbids.
 *
 * Pure arrays in, plain objects out — no store, no browser.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MIN_COVERAGE_FRACTION,
  computeDailyMicronutrients,
  computeDailyMicronutrientsInRange,
} from '../../app/lib/local-store/aggregates';
import type { MicronutrientsPer100g } from '../../app/lib/micronutrients';
import { MINERAL_KEYS, VITAMIN_KEYS } from '../../app/lib/micronutrients';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

const DAY = '2026-08-06';

/** A mineral block with every key null except the ones given — nothing is defaulted to 0. */
function minerals(values: Partial<Record<(typeof MINERAL_KEYS)[number], number>>) {
  // SAFETY: `MINERAL_KEYS` enumerates exactly the keys of the mineral block, and the map
  // supplies a `number | null` for each, so the built object has every required entry.
  return Object.fromEntries(
    MINERAL_KEYS.map((key) => [key, key in values ? values[key] : null]),
  ) as MicronutrientsPer100g['minerals'];
}

/** A vitamin block with every key null except the ones given. */
function vitamins(values: Partial<Record<(typeof VITAMIN_KEYS)[number], number>>) {
  // SAFETY: `VITAMIN_KEYS` enumerates exactly the keys of the vitamin block, and the map
  // supplies a `number | null` for each, so the built object has every required entry.
  return Object.fromEntries(
    VITAMIN_KEYS.map((key) => [key, key in values ? values[key] : null]),
  ) as MicronutrientsPer100g['vitamins'];
}

/**
 * A food log on `DAY`. `micronutrientsPer100g` is passed as-is — omitting it
 * models a manual entry or an AI-estimated plate, which carry no micronutrient
 * dimension at all.
 */
function foodLog(
  id: string,
  quantityGrams: number,
  micronutrientsPer100g?: MicronutrientsPer100g,
  overrides: Partial<LocalFoodLog> = {},
): LocalFoodLog {
  const log: LocalFoodLog = {
    id,
    name: id,
    quantityGrams,
    macros: { carbs: 5, fiber: 1, sugars: null, polyols: null, protein: 2, fat: 1, kcal: 40 },
    mealType: null,
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: DAY,
    loggedAt: Date.parse(`${DAY}T12:00:00Z`),
    createdAt: Date.parse(`${DAY}T12:00:00Z`),
    logBatchId: null,
  };
  if (micronutrientsPer100g) log.micronutrientsPer100g = micronutrientsPer100g;
  return Object.assign(log, overrides);
}

describe('computeDailyMicronutrients — a mixed day is not a covered day', () => {
  it('reports a DIFFERENT result for a partly-uncovered day than for a fully-covered one with the same total', () => {
    // Three 100 g foods. In both days exactly one carries 30 mg/100 g of
    // magnesium, so the raw sum is identical (30 mg) — the ONLY difference is
    // whether the other two have a figure at all.
    const covered = [
      foodLog('a', 100, { minerals: minerals({ magnesium: 30 }) }),
      foodLog('b', 100, { minerals: minerals({ magnesium: 0 }) }),
      foodLog('c', 100, { minerals: minerals({ magnesium: 0 }) }),
    ];
    const mixed = [
      foodLog('a', 100, { minerals: minerals({ magnesium: 30 }) }),
      // No micronutrient dimension at all — a manual entry and an AI plate.
      foodLog('b', 100),
      foodLog('c', 100, undefined, { source: 'plate_ai', aiEstimated: true }),
    ];

    const coveredDay = computeDailyMicronutrients(covered, DAY).byNutrient.magnesium;
    const mixedDay = computeDailyMicronutrients(mixed, DAY).byNutrient.magnesium;

    // Same arithmetic sum of the KNOWN values...
    assert.equal(coveredDay.amount, 30);
    // ...and yet the two days must NOT report the same thing. The mixed day is
    // one third covered, well under the bar, so it reports "not enough data"
    // instead of a confident 30 mg that would read as the person's whole intake.
    assert.notDeepEqual(coveredDay, mixedDay);
    assert.equal(coveredDay.hasEnoughData, true);
    assert.equal(mixedDay.hasEnoughData, false);
    assert.equal(mixedDay.amount, null);
    assert.equal(coveredDay.coveredFraction, 1);
    assert.ok(Math.abs(mixedDay.coveredFraction - 1 / 3) < 1e-9);
  });

  it('counts a measured 0 as covered and sums it as 0 — a zero is data, not a gap', () => {
    const logs = [
      foodLog('salt-free', 200, { minerals: minerals({ sodium: 0 }) }),
      foodLog('brine', 100, { minerals: minerals({ sodium: 400 }) }),
    ];

    const sodium = computeDailyMicronutrients(logs, DAY).byNutrient.sodium;

    assert.equal(sodium.hasEnoughData, true);
    assert.equal(sodium.amount, 400);
    assert.equal(sodium.coveredFraction, 1);
    assert.equal(sodium.contributingEntries, 2);
    assert.equal(sodium.coveredGrams, 300);
  });

  it('counts an absent block and a null value both as uncovered, and they are distinguishable upstream', () => {
    const logs = [
      // Block present, this nutrient's figure genuinely unknown.
      foodLog('null-value', 100, { minerals: minerals({ magnesium: 20 }) }),
      // No mineral block at all.
      foodLog('no-block', 100, { vitamins: vitamins({ vitaminC: 12 }) }),
    ];

    const day = computeDailyMicronutrients(logs, DAY);

    // `iron` is null on the first food and blockless on the second: both
    // uncovered, so nothing is summed and nothing is claimed.
    assert.equal(day.byNutrient.iron.hasEnoughData, false);
    assert.equal(day.byNutrient.iron.amount, null);
    assert.equal(day.byNutrient.iron.coveredFraction, 0);
    assert.equal(day.byNutrient.iron.contributingEntries, 0);
    // The two logs still differ in the model (one HAS a mineral block, one does
    // not) — the aggregation collapses them only for the coverage arithmetic.
    assert.equal(logs[0].micronutrientsPer100g?.minerals?.iron, null);
    assert.equal(logs[1].micronutrientsPer100g?.minerals, undefined);
  });

  it('never fabricates a zero for a nutrient nobody logged a figure for', () => {
    const logs = [foodLog('plain', 150)];
    const day = computeDailyMicronutrients(logs, DAY);

    for (const key of [...VITAMIN_KEYS, ...MINERAL_KEYS]) {
      assert.equal(day.byNutrient[key].amount, null, `${key} must be null, never 0`);
      assert.equal(day.byNutrient[key].hasEnoughData, false);
    }
  });

  it('weights coverage by grams, so a tiny fully-covered garnish cannot cover a big plate', () => {
    const logs = [foodLog('garnish', 5, { minerals: minerals({ magnesium: 100 }) }), foodLog('plate', 595)];

    const magnesium = computeDailyMicronutrients(logs, DAY).byNutrient.magnesium;

    // Half the ENTRIES have a figure; well under 1% of the mass does. A
    // count-weighted measure would have called this 50% covered.
    assert.equal(magnesium.contributingEntries, 1);
    assert.equal(magnesium.totalEntries, 2);
    assert.ok(magnesium.coveredFraction < 0.01);
    assert.equal(magnesium.hasEnoughData, false);
  });

  it('scales per-100 g figures onto the grams actually eaten', () => {
    const logs = [foodLog('spinach', 250, { minerals: minerals({ magnesium: 79 }) })];
    const magnesium = computeDailyMicronutrients(logs, DAY).byNutrient.magnesium;

    assert.equal(magnesium.hasEnoughData, true);
    assert.equal(magnesium.amount, 197.5);
  });

  it('honours an explicit coverage bar over the default', () => {
    const logs = [foodLog('known', 100, { minerals: minerals({ magnesium: 30 }) }), foodLog('unknown', 100)];

    const strict = computeDailyMicronutrients(logs, DAY).byNutrient.magnesium;
    const lax = computeDailyMicronutrients(logs, DAY, { minCoverageFraction: 0.5 }).byNutrient.magnesium;

    assert.equal(DEFAULT_MIN_COVERAGE_FRACTION, 0.6);
    assert.equal(strict.hasEnoughData, false);
    assert.equal(lax.hasEnoughData, true);
    assert.equal(lax.amount, 30);
  });

  it('reports an empty day as uncovered with no division by zero', () => {
    const day = computeDailyMicronutrients([], DAY);

    assert.equal(day.totalEntries, 0);
    assert.equal(day.totalGrams, 0);
    assert.equal(day.byNutrient.calcium.coveredFraction, 0);
    assert.equal(day.byNutrient.calcium.amount, null);
  });

  it('ignores entries from other days', () => {
    const logs = [
      foodLog('today', 100, { minerals: minerals({ magnesium: 30 }) }),
      foodLog('yesterday', 100, { minerals: minerals({ magnesium: 900 }) }, { dayKey: '2026-08-05' }),
    ];

    assert.equal(computeDailyMicronutrients(logs, DAY).byNutrient.magnesium.amount, 30);
  });
});

describe('computeDailyMicronutrientsInRange', () => {
  it('emits one entry per day including gap days, oldest first', () => {
    const logs = [foodLog('a', 100, { minerals: minerals({ iron: 4 }) }, { dayKey: '2026-08-05' })];

    const range = computeDailyMicronutrientsInRange(logs, { fromDate: '2026-08-04', toDate: '2026-08-06' });

    assert.deepEqual(
      range.map((day) => day.date),
      ['2026-08-04', '2026-08-05', '2026-08-06'],
    );
    assert.equal(range[0].byNutrient.iron.hasEnoughData, false);
    assert.equal(range[1].byNutrient.iron.amount, 4);
    assert.equal(range[2].byNutrient.iron.amount, null);
  });
});
