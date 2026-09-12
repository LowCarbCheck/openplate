/**
 * `/catch-up`'s yesterday rows: the wiring from `CatchUpDay` into the diary's
 * own `buildDayBudgetRows`, exercised at the exact shape the route builds it
 * in (`yesterdayBudgetTotals`, exported from `app/routes/catch-up.tsx` for
 * this reason).
 *
 * A prior defect hardcoded the fat total to `0` because the catch-up's own
 * three sentences never mention fat, leaving the fat row wrong for anyone who
 * ate any. The control fixture below (fat 0) is what that regression would
 * still pass with; the fat-44 fixture is the one that catches it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import i18next from '../../app/i18n/i18n';
import { buildDayBudgetRows } from '../../app/lib/day-budget-rows';
import { computeDayGaps } from '../../app/lib/macro-gaps';
import { yesterdayBudgetTotals } from '../../app/routes/catch-up';
import type { CatchUpDay, CatchUpGoals } from '../../app/models/catch-up';
import type { Translate } from '../../app/models/fasting';
import type { DayBudgetRow } from '../../app/lib/day-budget-rows';

const t: Translate = (key, params) => i18next.t(key, params ?? {});

/** The goals from the reported defect: a ceiling, a floor and a calorie target, all set. */
const GOALS: CatchUpGoals = { netCarbsCeiling: 50, proteinFloor: 90, kcalTarget: 1800 };

/** Yesterday, at the reported defect's other four figures, with `fatG` as the one thing under test. */
function yesterday(fatG: number): CatchUpDay {
  return { dayKey: '2026-09-11', meals: 3, netCarbsG: 47, proteinG: 86, kcal: 925, fatG, fiberG: 10 };
}

/** The fat row `/catch-up` would render for `day`, via the same pipeline the route calls. */
function fatRowFor(day: CatchUpDay): DayBudgetRow {
  const totals = yesterdayBudgetTotals(day);
  const gaps = computeDayGaps({
    totals: { netCarbs: totals.netCarbs, protein: totals.protein, fiber: totals.fiber },
    goals: { netCarbsCeiling: GOALS.netCarbsCeiling, proteinFloor: GOALS.proteinFloor },
    t,
  });
  const rows = buildDayBudgetRows({
    totals,
    goals: { netCarbsCeiling: GOALS.netCarbsCeiling, proteinFloor: GOALS.proteinFloor, kcalTarget: GOALS.kcalTarget },
    gaps,
    t,
    language: 'en',
  });
  const row = rows.find((candidate) => candidate.key === 'fat');
  if (!row) throw new Error('expected buildDayBudgetRows to include a fat row');
  return row;
}

describe('catch-up yesterday rows: fat', () => {
  it("shows yesterday's real fat total, carried from CatchUpDay.fatG", () => {
    const row = fatRowFor(yesterday(44));
    assert.equal(row.consumed, 44);
    assert.equal(row.progressText, '44 of 138 g');
  });

  it('control: a day with no fat logged shows zero, not a missing wire', () => {
    const row = fatRowFor(yesterday(0));
    assert.equal(row.consumed, 0);
    assert.equal(row.progressText, '0 of 138 g');
  });
});
