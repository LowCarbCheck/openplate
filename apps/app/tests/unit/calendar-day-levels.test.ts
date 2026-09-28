/**
 * Unit tests for `#app/lib/calendar-day-levels`, the per-day adherence level
 * map behind the diary calendar's colour fill.
 *
 * The two things worth pinning are the ones a naive copy of the grid's own
 * selector would get wrong: the map holds ONLY days that were actually
 * logged (a day-range selector, ported without thinking, would also emit an
 * entry for every gap day in between), and a day over its carb ceiling reads
 * a genuinely lower level than a day within it, not just a different status.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { selectCalendarDayLevels } from '../../app/lib/calendar-day-levels';
import type { AdherenceGoals } from '../../app/models/adherence-grid';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

const TODAY = '2026-09-06';
const OVER_CEILING_DAY = '2026-09-03';
const GAP_DAY = '2026-09-04';
const UNDER_CEILING_DAY = '2026-09-05';

/** Only a net-carbs ceiling is configured, so a resolved day lands on level 1 (missed) or level 4 (met), nothing in between. */
const GOALS: AdherenceGoals = { netCarbsCeilingG: 20, proteinFloorG: null, kcalTarget: null };

/** A minimal complete log; only `dayKey` and the carb macros matter here. */
function log({ dayKey, carbsG }: { dayKey: string; carbsG: number }): LocalFoodLog {
  return {
    id: `log-${dayKey}-${carbsG}`,
    name: 'test food',
    quantityGrams: 100,
    macros: { carbs: carbsG, fiber: 0, sugars: 0, polyols: null, protein: 5, fat: 5, kcal: 150 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey,
    loggedAt: Date.parse(`${dayKey}T12:00:00Z`),
    createdAt: Date.parse(`${dayKey}T12:00:00Z`),
    logBatchId: null,
  };
}

describe('selectCalendarDayLevels', () => {
  it('holds exactly the logged days, and no entry at all for a gap day between them', () => {
    const allLogs = [
      // Two logs on the same day, 20g net carbs each, 40g total, over the 20g ceiling.
      log({ dayKey: OVER_CEILING_DAY, carbsG: 20 }),
      log({ dayKey: OVER_CEILING_DAY, carbsG: 20 }),
      // One log, 8g net carbs, within the ceiling.
      log({ dayKey: UNDER_CEILING_DAY, carbsG: 8 }),
    ];

    const levels = selectCalendarDayLevels({ allLogs, goals: GOALS, today: TODAY });

    assert.deepEqual(Object.keys(levels).toSorted(), [OVER_CEILING_DAY, UNDER_CEILING_DAY]);
    // Control: a day-range selector (like the grid's own window) would also
    // have produced a slot for the day in between, logged or not.
    assert.equal(GAP_DAY in levels, false, 'a day with no log gets no entry at all, not an empty one');
  });

  it('grades a day over the carb ceiling to a lower level than a day within it', () => {
    const allLogs = [
      log({ dayKey: OVER_CEILING_DAY, carbsG: 20 }),
      log({ dayKey: OVER_CEILING_DAY, carbsG: 20 }),
      log({ dayKey: UNDER_CEILING_DAY, carbsG: 8 }),
    ];

    const levels = selectCalendarDayLevels({ allLogs, goals: GOALS, today: TODAY });

    assert.equal(levels[OVER_CEILING_DAY].status, 'rated');
    assert.equal(levels[UNDER_CEILING_DAY].status, 'rated');
    // With only one goal configured, a rated day lands at exactly level 1
    // (missed) or level 4 (met), nothing in between, so pinning both exact
    // values also proves the ordering: over the ceiling grades strictly
    // lower than within it, never tied and never the other way round.
    assert.equal(levels[OVER_CEILING_DAY].level, 1, 'over the ceiling must grade at the bottom of the ramp');
    assert.equal(levels[UNDER_CEILING_DAY].level, 4, 'within the ceiling must grade at the top of the ramp');
  });

  it('returns an empty map for a device with no logs', () => {
    const levels = selectCalendarDayLevels({ allLogs: [], goals: GOALS, today: TODAY });
    assert.deepEqual(levels, {});
  });
});
