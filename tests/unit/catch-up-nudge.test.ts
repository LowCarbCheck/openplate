/**
 * The nudge, and the three rules that keep it from becoming a lecture.
 *
 * 1. **Two of three, or nothing.** One day under a floor is a day, not a
 *    pattern. The one-day-under case is the CONTROL here: it must produce no
 *    nudge, which is what proves the two-day case is not simply "always on".
 * 2. **One nudge at most, protein first.** Two facts in one notification is a
 *    report card.
 * 3. **Foods the person has actually eaten.** Their own logged names, richest
 *    first, deduplicated, three of them. The fixed list of six is only for
 *    somebody with nothing in their history that carries the nutrient.
 *
 * And an empty yesterday carries no nudge at all, whatever the two days before
 * it looked like.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import i18next from '../../app/i18n/i18n';
import { buildCatchUp, resolveFallbackFoods } from '../../app/models/catch-up';
import type { CatchUpDay, CatchUpFood, CatchUpGoals, CatchUpInput } from '../../app/models/catch-up';
import type { Translate } from '../../app/models/fasting';

const t: Translate = (key, params) => i18next.t(key, params ?? {});

const TODAY = '2026-09-12';
const DAY_KEYS = ['2026-09-11', '2026-09-10', '2026-09-09'] as const;

/** Three logged days, with a protein figure, a fiber figure and an entry count each. */
function days(
  protein: [number, number, number],
  fiber: [number, number, number],
  meals: [number, number, number] = [3, 3, 3],
): CatchUpDay[] {
  return DAY_KEYS.map((dayKey, index) => ({
    dayKey,
    meals: meals[index] ?? 0,
    netCarbsG: 30,
    proteinG: protein[index] ?? 0,
    kcal: 1800,
    fiberG: fiber[index] ?? 0,
  }));
}

const FLOOR_90: CatchUpGoals = { netCarbsCeiling: 50, proteinFloor: 90, kcalTarget: null };
const NO_FLOOR: CatchUpGoals = { netCarbsCeiling: 50, proteinFloor: null, kcalTarget: null };

function input(overrides: Partial<CatchUpInput> & { days: CatchUpDay[] }): CatchUpInput {
  return {
    goals: FLOOR_90,
    fast: { status: 'none', coveredYesterday: false },
    recentFoods: [],
    fallbackFoods: resolveFallbackFoods(t),
    today: TODAY,
    locale: 'en',
    t,
    ...overrides,
  };
}

/** The nudge line, or null when there is none. Lines one and two are never it. */
function nudgeOf(built: { lines: string[] }): string | null {
  return built.lines.length === 0 ? null : (built.lines.at(-1)?.startsWith('Yesterday') ? null : (built.lines.at(-1) ?? null));
}

describe('the nudge threshold', () => {
  it('says nothing after ONE day under the floor, the control', () => {
    const built = buildCatchUp(input({ days: days([40, 120, 130], [30, 30, 30]) }));

    assert.deepEqual(built.lines, ['Yesterday: 3 meals, 30 g net carbs of your 50 g ceiling, 40 g protein of your 90 g floor.']);
  });

  it('speaks after TWO days under the floor', () => {
    const built = buildCatchUp(input({ days: days([40, 50, 130], [30, 30, 30]) }));

    assert.equal(
      nudgeOf(built),
      'Protein came in under your floor on two of the last three days. Eggs, skyr or chicken breast would close that gap.',
    );
  });

  it('counts three when all three were under', () => {
    const built = buildCatchUp(input({ days: days([40, 50, 60], [30, 30, 30]) }));

    assert.equal(
      nudgeOf(built),
      'Protein came in under your floor on three of the last three days. Eggs, skyr or chicken breast would close that gap.',
    );
  });

  it('never counts a day with no entries, because silence is not a deficiency', () => {
    // Yesterday is under the floor; the two days before it were never logged,
    // so there is one day under, not three.
    const built = buildCatchUp(input({ days: days([40, 0, 0], [30, 0, 0], [3, 0, 0]) }));

    assert.equal(nudgeOf(built), null);
  });

  it('carries no nudge on an empty yesterday, however the days before it read', () => {
    const built = buildCatchUp(input({ days: days([0, 20, 20], [0, 2, 2], [0, 3, 3]) }));

    assert.deepEqual(built.lines, ['Yesterday had no entries. Today starts fresh.']);
  });
});

describe('which floor speaks', () => {
  it('prefers protein over fiber when both qualify', () => {
    const built = buildCatchUp(input({ days: days([40, 50, 130], [2, 3, 30]) }));

    assert.match(nudgeOf(built) ?? '', /^Protein came in under your floor/);
  });

  it('falls to fiber when the person set no protein floor', () => {
    const built = buildCatchUp(input({ goals: NO_FLOOR, days: days([40, 50, 130], [2, 3, 30]) }));

    assert.equal(
      nudgeOf(built),
      'Fiber came in under the 25 g reference on two of the last three days. Chia seeds, raspberries or avocado would close that gap.',
    );
  });

  it('says nothing when neither floor was under twice', () => {
    const built = buildCatchUp(input({ days: days([120, 130, 140], [30, 31, 32]) }));

    assert.equal(nudgeOf(built), null);
  });
});

describe('which foods the nudge names', () => {
  const ownFoods: CatchUpFood[] = [
    { name: 'Skyr', proteinPer100g: 11, fiberPer100g: 0 },
    { name: 'skyr', proteinPer100g: 11, fiberPer100g: 0 },
    { name: 'Chicken breast', proteinPer100g: 31, fiberPer100g: 0 },
    { name: 'Eggs', proteinPer100g: 13, fiberPer100g: 0 },
    { name: 'Tuna', proteinPer100g: 26, fiberPer100g: 0 },
  ];

  it('names the person’s own foods, richest first, three of them, deduplicated', () => {
    const built = buildCatchUp(input({ days: days([40, 50, 130], [30, 30, 30]), recentFoods: ownFoods }));

    assert.equal(
      nudgeOf(built),
      'Protein came in under your floor on two of the last three days. Chicken breast, Tuna or Eggs would close that gap.',
    );
  });

  it('falls back to the fixed six when nothing in the history carries the nutrient', () => {
    const noFiber: CatchUpFood[] = [
      { name: 'Skyr', proteinPer100g: 11, fiberPer100g: 0 },
      { name: 'Chicken breast', proteinPer100g: 31, fiberPer100g: 0 },
      { name: 'Tuna', proteinPer100g: 26, fiberPer100g: null },
    ];
    const built = buildCatchUp(input({ goals: NO_FLOOR, days: days([120, 120, 120], [2, 3, 30]), recentFoods: noFiber }));

    assert.equal(
      nudgeOf(built),
      'Fiber came in under the 25 g reference on two of the last three days. Chia seeds, raspberries or avocado would close that gap.',
    );
  });

  it('names one food without an "or" when that is all the person has', () => {
    const one: CatchUpFood[] = [{ name: 'Skyr', proteinPer100g: 11, fiberPer100g: null }];
    const built = buildCatchUp(input({ days: days([40, 50, 130], [30, 30, 30]), recentFoods: one }));

    assert.match(nudgeOf(built) ?? '', /Skyr would close that gap\.$/);
  });
});
