/**
 * Unit tests for the pure helpers exported from `app/routes/diary.tsx`
 * (M12x diary readability round): meal grouping + subtotals (item 1),
 * favorite-name persistence parsing (item 6), and the portion/time display
 * helpers (items 1 and 7). Also covers the carbs-audit round: the single
 * net-carbs figure shared by every level of the page (`formatEntryNetCarbs`,
 * `formatNetCarbGrams`), the "unknown" macro fallback (`formatMacroOrUnknown`),
 * and the backup-nudge data gate (`hasDataWorthBackingUp`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import i18next from '../../app/i18n/i18n';
import deCommon from '../../app/i18n/locales/de/common.json';
import {
  formatEntryNetCarbs,
  formatEntryPortion,
  formatEntryTime,
  formatMacroBreakdownLine,
  formatMacroOrUnknown,
  formatNetCarbGrams,
  groupLogsByMeal,
  hasDataWorthBackingUp,
  mealGroupLabel,
  parseFavoriteNames,
  serializeFavoriteNames,
  toggleFavoriteName,
  type Translate,
} from '../../app/routes/diary';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';
import type { DaySummary } from '../../app/models/food-log-summary';

/**
 * The REAL catalog rather than a stub translator: every helper below returns a
 * user-facing sentence, so asserting the shipped English is what makes these
 * copy tests instead of key-spelling tests.
 */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

const DAY = '2026-07-20';

/** A complete food log for `DAY`; override any field per test. */
function log(id: string, overrides: Partial<LocalFoodLog> = {}): LocalFoodLog {
  return {
    id,
    name: id,
    quantityGrams: 100,
    macros: { carbs: 10, fiber: 2, sugars: 3, polyols: null, protein: 5, fat: 4, kcal: 120 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: DAY,
    loggedAt: Date.parse(`${DAY}T12:00:00Z`),
    createdAt: Date.parse(`${DAY}T12:00:00Z`),
    logBatchId: null,
    ...overrides,
  };
}

describe('groupLogsByMeal', () => {
  it('groups entries by meal in breakfast → lunch → dinner → snack → no-meal order, regardless of input order', () => {
    const logs = [
      log('snack-1', { mealType: 'snack' }),
      log('breakfast-1', { mealType: 'breakfast' }),
      log('no-meal-1', { mealType: null }),
      log('lunch-1', { mealType: 'lunch' }),
    ];
    const groups = groupLogsByMeal(logs);
    assert.deepEqual(
      groups.map((group) => group.mealType),
      ['breakfast', 'lunch', 'snack', null],
    );
  });

  it('omits meal groups with no entries', () => {
    const groups = groupLogsByMeal([log('a', { mealType: 'dinner' })]);
    assert.deepEqual(
      groups.map((group) => group.mealType),
      ['dinner'],
    );
  });

  it('preserves the caller-supplied order of entries within a group', () => {
    const first = log('first', { mealType: 'lunch', loggedAt: Date.parse(`${DAY}T11:00:00Z`) });
    const second = log('second', { mealType: 'lunch', loggedAt: Date.parse(`${DAY}T13:00:00Z`) });
    const groups = groupLogsByMeal([first, second]);
    assert.deepEqual(
      groups[0].logs.map((entry) => entry.id),
      ['first', 'second'],
    );
  });

  it('computes each group\'s own subtotal from only that group\'s entries', () => {
    const breakfast = log('b', { mealType: 'breakfast', macros: { carbs: 10, fiber: 0, sugars: 0, polyols: null, protein: 0, fat: 0, kcal: 40 } });
    const lunch = log('l', { mealType: 'lunch', macros: { carbs: 30, fiber: 0, sugars: 0, polyols: null, protein: 0, fat: 0, kcal: 120 } });
    const groups = groupLogsByMeal([breakfast, lunch]);
    const breakfastGroup = groups.find((group) => group.mealType === 'breakfast');
    const lunchGroup = groups.find((group) => group.mealType === 'lunch');
    assert.equal(breakfastGroup?.subtotal.netCarbs, 10);
    assert.equal(lunchGroup?.subtotal.netCarbs, 30);
  });

  it('returns no groups for an empty day', () => {
    assert.deepEqual(groupLogsByMeal([]), []);
  });
});

describe('mealGroupLabel', () => {
  it('capitalizes a known meal type', () => {
    assert.equal(mealGroupLabel('breakfast', t), 'Breakfast');
    assert.equal(mealGroupLabel('snack', t), 'Snack');
  });

  it('labels the null (no-meal) group distinctly', () => {
    assert.equal(mealGroupLabel(null, t), 'No meal');
  });
});

describe('formatEntryPortion', () => {
  it('falls back to a plain gram figure when no portion was recorded', () => {
    assert.equal(formatEntryPortion(log('a', { quantityGrams: 150, portion: null }), 'en'), '150\u00a0g');
  });

  it('shows the household-unit label plus the authoritative grams when a portion was recorded', () => {
    const entry = log('a', { quantityGrams: 100, portion: { unit: 'egg', quantity: 2, gramsPerUnit: 50 } });
    assert.equal(formatEntryPortion(entry, 'en'), '2 eggs (100\u00a0g)');
  });

  // Release-QA defect B: this row printed "182g" while the day ring above it
  // printed "0,8 g". One helper, one space, both languages.
  it('separates the figure from its unit in every language', () => {
    const entry = log('a', { quantityGrams: 182, portion: { unit: 'apple', quantity: 1, gramsPerUnit: 182 } });
    // The NOUN is translated too (a German row reads "1 Apfel", never "1
    // apple"), so the German expectation is built from the shipped bundle
    // rather than pinning machine-produced copy — see
    // `portions-portion-options.test.ts`. What this case guards is the space.
    const apple = deCommon.portions.unit.apple_one.replace('{{count}}', '1');
    assert.equal(formatEntryPortion(entry, 'de'), `${apple} (182\u00a0g)`);
    assert.equal(formatEntryPortion(entry, 'en'), '1 apple (182\u00a0g)');
  });
});

describe('formatEntryTime', () => {
  it('formats an instant as a local time string in the given time zone', () => {
    const instant = Date.parse('2026-07-20T14:32:00Z');
    assert.equal(formatEntryTime(instant, 'UTC'), '2:32 PM');
  });

  it('uses the 24-hour clock when the UI language is German', () => {
    const instant = Date.parse('2026-07-20T08:32:00Z');
    // 12- vs 24-hour is a locale convention, not a user setting: an English UI
    // gets "8:32 AM", a German one "08:32" — never a German page with "AM".
    assert.equal(formatEntryTime(instant, 'UTC', 'en'), '8:32 AM');
    assert.equal(formatEntryTime(instant, 'UTC', 'de'), '08:32');
  });
});

describe('favorite-name persistence (localStorage parse/serialize/toggle)', () => {
  it('parses a missing value as an empty set', () => {
    assert.deepEqual(parseFavoriteNames(null), new Set());
  });

  it('parses a valid JSON array of names', () => {
    assert.deepEqual(parseFavoriteNames('["eggs","oatmeal"]'), new Set(['eggs', 'oatmeal']));
  });

  it('treats corrupt JSON as no favorites, never throwing', () => {
    assert.deepEqual(parseFavoriteNames('{not json'), new Set());
  });

  it('treats a non-array JSON value as no favorites', () => {
    assert.deepEqual(parseFavoriteNames('{"eggs":true}'), new Set());
  });

  it('drops non-string entries from an otherwise-valid array', () => {
    assert.deepEqual(parseFavoriteNames('["eggs", 42, null]'), new Set(['eggs']));
  });

  it('round-trips through serialize then parse', () => {
    const names = new Set(['eggs', 'oatmeal']);
    assert.deepEqual(parseFavoriteNames(serializeFavoriteNames(names)), names);
  });

  it('toggle adds an absent name (case/whitespace-insensitive)', () => {
    const next = toggleFavoriteName(new Set(), '  Eggs  ');
    assert.deepEqual(next, new Set(['eggs']));
  });

  it('toggle removes a present name', () => {
    const next = toggleFavoriteName(new Set(['eggs']), 'eggs');
    assert.deepEqual(next, new Set());
  });

  it('toggle never mutates the input set', () => {
    const original = new Set(['eggs']);
    toggleFavoriteName(original, 'oatmeal');
    assert.deepEqual(original, new Set(['eggs']));
  });
});

describe('formatEntryNetCarbs (carbs-audit round, item 1: entry rows show NET carbs, not total)', () => {
  it('computes net carbs (carbs minus fiber minus polyols) for the entry, not total carbs', () => {
    const entry = log('a', { macros: { carbs: 10, fiber: 3, sugars: 0, polyols: 1, protein: 0, fat: 0, kcal: 0 } });
    assert.equal(formatEntryNetCarbs(entry, t, 'en'), '6 g net carbs');
  });

  it('clamps at zero when fiber and polyols exceed carbs', () => {
    const entry = log('a', { macros: { carbs: 2, fiber: 5, sugars: 0, polyols: 0, protein: 0, fat: 0, kcal: 0 } });
    assert.equal(formatEntryNetCarbs(entry, t, 'en'), '0 g net carbs');
  });

  it('reports "unknown" rather than a fabricated 0g when the entry has no carbs data at all', () => {
    const entry = log('a', { macros: { carbs: null, fiber: null, sugars: null, polyols: null, protein: 5, fat: 2, kcal: 40 } });
    assert.equal(formatEntryNetCarbs(entry, t, 'en'), 'net carbs unknown');
  });

  it('hedges with a leading "~" when the entry is AI-estimated', () => {
    const entry = log('a', {
      aiEstimated: true,
      macros: { carbs: 10, fiber: 2, sugars: 0, polyols: 0, protein: 0, fat: 0, kcal: 0 },
    });
    assert.equal(formatEntryNetCarbs(entry, t, 'en'), '~8 g net carbs');
  });

  it('treats unknown fiber/polyols as 0 for the subtraction (conservative reading), never hiding a known carbs figure', () => {
    const entry = log('a', { macros: { carbs: 12, fiber: null, sugars: 0, polyols: null, protein: 0, fat: 0, kcal: 0 } });
    assert.equal(formatEntryNetCarbs(entry, t, 'en'), '12 g net carbs');
  });
});

describe('formatMacroOrUnknown (carbs-audit round, item 2: no more "—g" for an unrecorded macro)', () => {
  it('renders a known value with its unit, separated by the shared no-break space', () => {
    assert.equal(formatMacroOrUnknown(12.4, 'g', t, 'en'), '12.4\u00a0g');
    assert.equal(formatMacroOrUnknown(12.4, 'g', t, 'de'), '12,4\u00a0g');
  });

  // The calories column passes '' — its label already names the quantity — and
  // must not pick up a trailing space from the shared unit helper.
  it('renders a bare number when the caller supplies no unit', () => {
    assert.equal(formatMacroOrUnknown(105.6, '', t, 'en'), '105.6');
  });

  it('renders "unknown" — never a dangling unit — for a null value', () => {
    assert.equal(formatMacroOrUnknown(null, 'g', t, 'en'), 'unknown');
    assert.equal(formatMacroOrUnknown(null, ' kcal', t, 'en'), 'unknown');
  });
});

describe('formatNetCarbGrams (carbs-audit round, item 4: one rounding policy at every level)', () => {
  it('formats to at most one decimal place, matching the entry-level formatter', () => {
    assert.equal(formatNetCarbGrams(9.649, false, 'en'), '9.6');
  });

  it('hedges with a leading "~" when the total includes AI estimates', () => {
    assert.equal(formatNetCarbGrams(9.6, true, 'en'), '~9.6');
  });

  it('does not silently round a sub-gram total down to 0', () => {
    assert.equal(formatNetCarbGrams(0.3, false, 'en'), '0.3');
  });

  it("writes the figure with the active language's decimal separator", () => {
    assert.equal(formatNetCarbGrams(9.6, false, 'de'), '9,6');
    assert.equal(formatNetCarbGrams(9.6, true, 'de'), '~9,6');
  });
});

/** A complete DaySummary; override any field per test. */
function daySummary(overrides: Partial<DaySummary> = {}): DaySummary {
  return {
    carbs: 12.4,
    fiber: 2,
    polyols: 0,
    netCarbs: 10.4,
    protein: 20,
    fat: 5,
    kcal: 350,
    hasUnknowns: false,
    hasEstimates: false,
    ...overrides,
  };
}

describe('formatMacroBreakdownLine (jargon round: "kcal" spelled out, sub-gram grams no longer vanish)', () => {
  it('never renders the "kcal" jargon abbreviation', () => {
    assert.equal(/kcal/i.test(formatMacroBreakdownLine(daySummary(), t, 'en')), false);
    assert.match(formatMacroBreakdownLine(daySummary(), t, 'en'), /calories/);
  });

  it('does not silently round a sub-gram macro down to "0g" (the headline-level fix, applied here too)', () => {
    const line = formatMacroBreakdownLine(daySummary({ carbs: 0.3, fiber: 0.2 }), t, 'en');
    assert.match(line, /Carbs 0\.3 g/);
    assert.match(line, /Fiber 0\.2 g/);
  });

  it('rounds calories to a whole number', () => {
    assert.match(formatMacroBreakdownLine(daySummary({ kcal: 349.6 }), t, 'en'), /350 calories/);
  });
});

describe('hasDataWorthBackingUp (carbs-audit round, item 6: nudge gate ignores a bare profile row)', () => {
  it('is false when the device has logged nothing at all (a profile row alone does not count)', () => {
    assert.equal(hasDataWorthBackingUp({ logCount: 0, foodCount: 0, weightEntryCount: 0 }), false);
  });

  it('is true once the device has any food log', () => {
    assert.equal(hasDataWorthBackingUp({ logCount: 1, foodCount: 0, weightEntryCount: 0 }), true);
  });

  it('is true once the device has any custom food, even with no logs yet', () => {
    assert.equal(hasDataWorthBackingUp({ logCount: 0, foodCount: 1, weightEntryCount: 0 }), true);
  });

  it('is true once the device has any weight entry, even with no logs yet', () => {
    assert.equal(hasDataWorthBackingUp({ logCount: 0, foodCount: 0, weightEntryCount: 1 }), true);
  });
});
